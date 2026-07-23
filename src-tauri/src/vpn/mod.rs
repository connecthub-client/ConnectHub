pub mod setup;

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use dashmap::DashMap;
use serde::Serialize;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, oneshot};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::vpn_profile::VpnProfile;
use crate::state::AppState;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum VpnState {
    Connecting,
    Connected,
    Disconnecting,
    Disconnected,
    Error,
}

#[derive(Debug, Clone, Serialize)]
pub struct VpnStatus {
    pub state: VpnState,
    pub message: Option<String>,
}

impl VpnStatus {
    fn disconnected() -> Self {
        Self { state: VpnState::Disconnected, message: None }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct VpnConnectionStatus {
    pub profile_id: Uuid,
    pub status: VpnStatus,
}

enum VpnControl {
    Disconnect,
}

pub(crate) struct ActiveVpn {
    commands: mpsc::UnboundedSender<VpnControl>,
    status: Arc<Mutex<VpnStatus>>,
    // Populated once, by add_host_routes, the moment the tunnel interface is
    // known - lets ensure_host_route (below) add a route for a host on
    // demand without needing to rediscover the interface itself.
    tun_iface: Arc<Mutex<Option<String>>>,
    // Shared with add_host_routes/ensure_host_route so every route added
    // for this connection (whether at initial connect or added later on
    // demand) is retracted by cleanup() on disconnect - see
    // remove_host_routes.
    added_routes: Arc<Mutex<Vec<(String, String)>>>,
}

pub type VpnMap = Arc<DashMap<Uuid, ActiveVpn>>;

// Where uploaded .ovpn configs (and, if needed, auth-user-pass credential
// files) are written just before connecting. Must match the directory the
// installed helper script (`vpn::setup::HELPER_SCRIPT`) validates paths
// against - it derives the same path from $PKEXEC_UID at run time since
// pkexec resets $HOME to root's.
pub fn profiles_dir() -> AppResult<PathBuf> {
    let mut dir = dirs::data_dir()
        .ok_or_else(|| AppError::Vpn("could not determine platform data directory".into()))?;
    dir.push("sshtool");
    dir.push("vpn-profiles");
    std::fs::create_dir_all(&dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(dir)
}

// A .ovpn/.auth file only ever exists here for the duration of one
// connection attempt - written just before spawning openvpn, removed again
// by cleanup() when that connection ends (successfully, on error, or on
// disconnect). Anything still here at startup is therefore leftover from a
// run that didn't get to finish that cleanup, almost always because the
// process was killed rather than exited - a graceful shutdown already
// disconnects every profile (see disconnect_all in lib.rs's ExitRequested
// handler) before the process actually exits.
//
// This only removes the files, not a possibly-still-running root-owned
// openvpn process from that same crashed run: killing one safely would
// need its own privilege-escalation plumbing (an unprivileged process
// can't signal a root-owned one, same reason run_vpn talks to it over its
// management interface instead of via signals) and this app has no record
// of which management port a previous, now-gone process instance was
// using to be able to ask it to shut down cleanly. A leftover openvpn
// process from a crash is otherwise harmless (still routes traffic
// correctly) until the machine is rebooted or it's stopped by hand -
// tracked as a follow-up rather than solved here.
//
// Best-effort like the rest of this module, and assumes only one instance
// of the app runs at a time against this directory - same assumption the
// rest of the app already makes about its SQLite database.
pub fn cleanup_stale_profile_files() {
    let Ok(dir) = profiles_dir() else { return };
    cleanup_stale_profile_files_in(&dir);
}

fn cleanup_stale_profile_files_in(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let _ = std::fs::remove_file(entry.path());
    }
}

fn write_private_file(path: &Path, contents: &str) -> AppResult<()> {
    std::fs::write(path, contents)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

// When multiple VPN profiles (e.g. one per project) are meant to be
// connected at once, each grabbing the default route (`redirect-gateway`,
// commonly pushed even when only a private subnet actually needs to be
// reached) causes them to fight over which one owns "the internet" -
// symptoms range from the second profile failing to connect to the whole
// machine losing connectivity. Appending this filters that specific pushed
// option back out, so the tunnel still gets whatever subnet routes the
// server pushes (route(s) to the private network) without taking over
// 0.0.0.0/0. Appended (not prepended): pull-filter rules are evaluated in
// order with first-match-wins, so this only has an effect if the uploaded
// profile doesn't already define its own conflicting pull-filter rule for
// "redirect-gateway" earlier in the file - true for the overwhelming
// majority of real-world profiles, which don't touch pull-filter at all.
fn effective_config(profile: &VpnProfile) -> String {
    if profile.avoid_default_route {
        format!("{}\npull-filter ignore \"redirect-gateway\"\n", profile.config)
    } else {
        profile.config.clone()
    }
}

pub fn status(vpn_map: &VpnMap, profile_id: Uuid) -> VpnStatus {
    vpn_map
        .get(&profile_id)
        .map(|entry| entry.status.lock().unwrap().clone())
        .unwrap_or_else(VpnStatus::disconnected)
}

pub fn list_active(vpn_map: &VpnMap) -> Vec<VpnConnectionStatus> {
    vpn_map
        .iter()
        .map(|entry| VpnConnectionStatus {
            profile_id: *entry.key(),
            status: entry.status.lock().unwrap().clone(),
        })
        .collect()
}

// Idempotent no-op if the profile isn't connected - the background task
// removes the map entry itself once it's actually torn down.
pub fn disconnect(vpn_map: &VpnMap, profile_id: Uuid) -> AppResult<()> {
    if let Some(entry) = vpn_map.get(&profile_id) {
        let _ = entry.commands.send(VpnControl::Disconnect);
    }
    Ok(())
}

// Signals every currently-connected (or connecting) profile to shut down -
// used as a safety net on app exit, so a VPN a user forgot to disconnect
// (or one left over from a session/tunnel the app didn't get a chance to
// clean up after) doesn't keep quietly rerouting traffic once the app
// closes. Doesn't wait for the shutdowns to finish: each openvpn process
// runs independently of this one, so signaling it to stop is enough even
// if this process exits before that finishes.
pub fn disconnect_all(vpn_map: &VpnMap) {
    for entry in vpn_map.iter() {
        let _ = entry.commands.send(VpnControl::Disconnect);
    }
}

pub async fn connect(state: &AppState, vpn_map: VpnMap, profile_id: Uuid) -> AppResult<VpnStatus> {
    if let Some(entry) = vpn_map.get(&profile_id) {
        let current = entry.status.lock().unwrap().clone();
        if matches!(
            current.state,
            VpnState::Connecting | VpnState::Connected | VpnState::Disconnecting
        ) {
            return Ok(current);
        }
    }

    if !setup::is_installed() {
        return Err(AppError::Vpn(
            "VPN privilege setup hasn't been run yet - open the VPN tab and run setup first"
                .into(),
        ));
    }

    // Claim this profile's slot in `vpn_map` atomically, right here, before
    // any of the fallible async setup below (db reads, file writes,
    // spawning the pkexec helper). The `get` above and this claim are two
    // separate DashMap operations - without an atomic claim between them,
    // several concurrent connect() calls racing for the same
    // not-yet-connected profile (e.g. Snippets' "run on hosts" gating
    // multiple hosts that share one VPN profile, all in parallel) could
    // each observe the profile as absent, and each go on to launch its own
    // full openvpn process for it: every insert after the first would
    // silently overwrite the previous ActiveVpn entry, leaking an orphaned
    // openvpn process this app can no longer see or disconnect, and
    // potentially fighting over the same tun routes. See try_claim's own
    // comment for how the atomicity is actually achieved.
    let claim = match try_claim(&vpn_map, profile_id) {
        Err(current) => return Ok(current),
        Ok(claim) => claim,
    };

    match start_connection(
        state,
        profile_id,
        claim.status.clone(),
        claim.control_rx,
        claim.tun_iface,
        claim.added_routes,
        vpn_map.clone(),
    )
    .await
    {
        Ok(final_status) => Ok(final_status),
        Err(e) => {
            // The claim above was speculative - nothing was actually
            // launched, so run_vpn's own cleanup() will never run to
            // remove this entry. Without this, a failed connect attempt
            // (bad profile data, disk full, pkexec missing) would leave a
            // phantom "Connecting" entry in vpn_map forever: every future
            // connect() call for this profile would see it as Occupied and
            // just echo the same stale status back, permanently blocking
            // any real reconnect attempt.
            vpn_map.remove(&profile_id);
            Err(e)
        }
    }
}

struct ClaimedConnection {
    status: Arc<Mutex<VpnStatus>>,
    control_rx: mpsc::UnboundedReceiver<VpnControl>,
    tun_iface: Arc<Mutex<Option<String>>>,
    added_routes: Arc<Mutex<Vec<(String, String)>>>,
}

// Atomically claims `profile_id`'s slot in `vpn_map` for a new connection
// attempt: `Entry::Vacant`/`Entry::Occupied` is a single DashMap operation
// (one shard lock, held only for this synchronous match), so of any number
// of threads calling this for the same not-yet-connected profile at once,
// exactly one observes `Vacant` and inserts, and every other one - even if
// it started the race a moment earlier - is guaranteed to see the
// just-inserted entry as `Occupied` rather than also seeing `Vacant`. An
// `Occupied` entry always means Connecting, Connected, or Disconnecting
// (see cleanup(), which removes the entry on every terminal state), so
// reporting its current status back here is correct for all three: none of
// them should trigger launching a second, competing connection.
fn try_claim(vpn_map: &VpnMap, profile_id: Uuid) -> Result<ClaimedConnection, VpnStatus> {
    let status = Arc::new(Mutex::new(VpnStatus { state: VpnState::Connecting, message: None }));
    let tun_iface: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let added_routes: Arc<Mutex<Vec<(String, String)>>> = Arc::new(Mutex::new(Vec::new()));
    let (control_tx, control_rx) = mpsc::unbounded_channel();
    match vpn_map.entry(profile_id) {
        dashmap::mapref::entry::Entry::Occupied(e) => Err(e.get().status.lock().unwrap().clone()),
        dashmap::mapref::entry::Entry::Vacant(e) => {
            e.insert(ActiveVpn {
                commands: control_tx,
                status: status.clone(),
                tun_iface: tun_iface.clone(),
                added_routes: added_routes.clone(),
            });
            Ok(ClaimedConnection { status, control_rx, tun_iface, added_routes })
        }
    }
}

// The fallible half of connecting - db reads, config/auth file writes,
// binding the management port, and spawning the pkexec helper - split out
// so `connect` above can remove its speculative vpn_map claim on any
// failure here (see its own comment) without duplicating this logic.
#[allow(clippy::too_many_arguments)]
async fn start_connection(
    state: &AppState,
    profile_id: Uuid,
    status: Arc<Mutex<VpnStatus>>,
    control_rx: mpsc::UnboundedReceiver<VpnControl>,
    tun_iface: Arc<Mutex<Option<String>>>,
    added_routes: Arc<Mutex<Vec<(String, String)>>>,
    vpn_map: VpnMap,
) -> AppResult<VpnStatus> {
    let (profile, auth) = {
        let conn = state.db.lock().unwrap();
        state.with_key(|key| {
            crate::data::vpn_profiles::get_with_decrypted_auth(&conn, key, profile_id)
        })?
    };

    // Every host that uses this profile gets an explicit route through its
    // tunnel once connected (see add_host_routes) - resolved now, before
    // the connection even starts, so run_vpn doesn't need db/state access.
    let target_hostnames: Vec<String> = {
        let conn = state.db.lock().unwrap();
        crate::data::hosts::list_by_vpn_profile(&conn, profile_id)?
            .into_iter()
            .map(|h| h.hostname)
            .collect()
    };

    let dir = profiles_dir()?;
    let config_path = dir.join(format!("{profile_id}.ovpn"));
    write_private_file(&config_path, &effective_config(&profile))?;

    let auth_path = match &auth {
        Some((username, password)) => {
            let path = dir.join(format!("{profile_id}.auth"));
            write_private_file(&path, &format!("{username}\n{password}\n"))?;
            Some(path)
        }
        None => None,
    };

    // Bind an ephemeral port to claim it, then release it immediately -
    // openvpn (started moments later) rebinds the same port. A small race
    // in principle, but fine for a local desktop app with no adversary
    // racing to steal a just-freed loopback port.
    let mgmt_port = {
        let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
        listener.local_addr()?.port()
    };

    let child = tokio::process::Command::new("pkexec")
        .arg(setup::HELPER_PATH)
        .arg(&config_path)
        .arg(mgmt_port.to_string())
        .arg(
            auth_path
                .as_ref()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default(),
        )
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| AppError::Vpn(format!("failed to launch pkexec: {e}")))?;

    let (ready_tx, ready_rx) = oneshot::channel();

    tokio::spawn(run_vpn(
        profile_id,
        child,
        mgmt_port,
        status.clone(),
        control_rx,
        vpn_map,
        config_path,
        auth_path,
        ready_tx,
        target_hostnames,
        added_routes,
        tun_iface,
    ));

    // Wait (bounded) for the first Connected/Error transition so the
    // frontend gets a definitive answer instead of having to poll; if we
    // time out, the connection attempt is still proceeding in the
    // background and a later `vpn_status` call will reflect it.
    match tokio::time::timeout(Duration::from_secs(25), ready_rx).await {
        Ok(Ok(final_status)) => Ok(final_status),
        _ => Ok(status.lock().unwrap().clone()),
    }
}

#[allow(clippy::too_many_arguments)]
async fn run_vpn(
    profile_id: Uuid,
    mut child: tokio::process::Child,
    mgmt_port: u16,
    status: Arc<Mutex<VpnStatus>>,
    mut control_rx: mpsc::UnboundedReceiver<VpnControl>,
    vpn_map: VpnMap,
    config_path: PathBuf,
    auth_path: Option<PathBuf>,
    ready_tx: oneshot::Sender<VpnStatus>,
    target_hostnames: Vec<String>,
    added_routes: Arc<Mutex<Vec<(String, String)>>>,
    tun_iface: Arc<Mutex<Option<String>>>,
) {
    let mut ready_tx = Some(ready_tx);

    let mgmt_stream = loop {
        match tokio::net::TcpStream::connect(("127.0.0.1", mgmt_port)).await {
            Ok(s) => break Some(s),
            Err(_) => match child.try_wait() {
                Ok(Some(_)) => break None,
                _ => tokio::time::sleep(Duration::from_millis(300)).await,
            },
        }
    };

    let Some(mgmt_stream) = mgmt_stream else {
        let final_status = VpnStatus {
            state: VpnState::Error,
            message: Some(
                "openvpn exited before its management interface came up (authentication cancelled?)"
                    .into(),
            ),
        };
        *status.lock().unwrap() = final_status.clone();
        if let Some(tx) = ready_tx.take() {
            let _ = tx.send(final_status);
        }
        cleanup(&vpn_map, profile_id, &config_path, &auth_path, &added_routes).await;
        return;
    };

    let (read_half, mut write_half) = mgmt_stream.into_split();
    // Real-time STATE push notifications are opt-in on the management
    // interface - without this, `state` only answers on-demand queries.
    let _ = write_half.write_all(b"state on\r\n").await;
    let mut lines = BufReader::new(read_half).lines();

    loop {
        tokio::select! {
            line = lines.next_line() => {
                match line {
                    Ok(Some(text)) => {
                        if let Some(update) = parse_management_line(&text) {
                            let update_state = update.state;
                            *status.lock().unwrap() = update.clone();
                            if matches!(update_state, VpnState::Connected | VpnState::Error) {
                                if let Some(tx) = ready_tx.take() {
                                    let _ = tx.send(update);
                                }
                            }
                            if update_state == VpnState::Connected {
                                if let Some(local_ip) = extract_local_tunnel_ip(&text) {
                                    let hostnames = target_hostnames.clone();
                                    let added_routes = added_routes.clone();
                                    let tun_iface = tun_iface.clone();
                                    tokio::spawn(add_host_routes(local_ip, hostnames, added_routes, tun_iface));
                                }
                            }
                        }
                    }
                    Ok(None) | Err(_) => break,
                }
            }
            cmd = control_rx.recv() => {
                match cmd {
                    Some(VpnControl::Disconnect) => {
                        *status.lock().unwrap() =
                            VpnStatus { state: VpnState::Disconnecting, message: None };
                        let _ = write_half.write_all(b"signal SIGTERM\r\n").await;
                    }
                    None => break,
                }
            }
        }
    }

    let was_error = matches!(status.lock().unwrap().state, VpnState::Error);
    let final_status = if was_error {
        status.lock().unwrap().clone()
    } else {
        VpnStatus::disconnected()
    };
    *status.lock().unwrap() = final_status.clone();
    if let Some(tx) = ready_tx.take() {
        let _ = tx.send(final_status);
    }

    let _ = child.wait().await;
    cleanup(&vpn_map, profile_id, &config_path, &auth_path, &added_routes).await;
}

async fn cleanup(
    vpn_map: &VpnMap,
    profile_id: Uuid,
    config_path: &Path,
    auth_path: &Option<PathBuf>,
    added_routes: &Arc<Mutex<Vec<(String, String)>>>,
) {
    vpn_map.remove(&profile_id);
    remove_host_routes(added_routes).await;
    let _ = tokio::fs::remove_file(config_path).await;
    if let Some(p) = auth_path {
        let _ = tokio::fs::remove_file(p).await;
    }
}

// Retracts every route add_host_routes actually added for this connection.
// Without this, a host's /32 route (see add_host_routes) outlives the VPN
// that installed it: it keeps pointing at a now-torn-down tun interface
// until either a reboot or the next connection happens to reuse the same
// interface name and IP, at which point traffic could silently follow the
// wrong tunnel. Best-effort like the rest of this module - a failure here
// doesn't block disconnecting, worst case a stale route lingers exactly as
// it would have before this existed.
async fn remove_host_routes(added_routes: &Arc<Mutex<Vec<(String, String)>>>) {
    let routes = std::mem::take(&mut *added_routes.lock().unwrap());
    if routes.is_empty() || !std::path::Path::new(setup::ROUTE_HELPER_PATH).exists() {
        return;
    }
    for (iface, ip) in routes {
        let _ = tokio::process::Command::new("pkexec")
            .arg(setup::ROUTE_HELPER_PATH)
            .arg("del")
            .arg(&iface)
            .arg(&ip)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .await;
    }
}

// Only two outcomes actually change what the UI shows: reaching CONNECTED,
// or a fatal/auth error. Everything else (WAIT/AUTH/GET_CONFIG/ASSIGN_IP,
// reconnect attempts, the EXITING state on a normal disconnect we asked
// for) is left as-is rather than modeled precisely - the process/socket
// closing is what ultimately drives the Disconnected transition.
fn parse_management_line(line: &str) -> Option<VpnStatus> {
    if let Some(rest) = line.strip_prefix(">FATAL:") {
        return Some(VpnStatus { state: VpnState::Error, message: Some(rest.trim().to_string()) });
    }
    if line.contains("AUTH_FAILED") || line.contains("Verification Failed") {
        return Some(VpnStatus {
            state: VpnState::Error,
            message: Some(line.trim_start_matches('>').trim().to_string()),
        });
    }
    if let Some(rest) = line.strip_prefix(">STATE:") {
        let phase = rest.split(',').nth(1).unwrap_or("");
        if phase == "CONNECTED" {
            return Some(VpnStatus { state: VpnState::Connected, message: None });
        }
    }
    None
}

// `>STATE:<ts>,CONNECTED,SUCCESS,<local_tunnel_ip>,<remote_ip>,<remote_port>,,` -
// the local tunnel IP (4th field) is what lets us find which tun interface
// this particular connection is using, further down in add_host_routes.
fn extract_local_tunnel_ip(line: &str) -> Option<String> {
    let rest = line.strip_prefix(">STATE:")?;
    let mut parts = rest.split(',');
    parts.next()?; // timestamp
    if parts.next()? != "CONNECTED" {
        return None;
    }
    parts.next()?; // "SUCCESS"
    let local_ip = parts.next()?;
    if local_ip.is_empty() {
        None
    } else {
        Some(local_ip.to_string())
    }
}

// Explicitly routes each of this profile's assigned hosts through its own
// tunnel, once connected - see the comment on setup::ROUTE_HELPER_PATH for
// why: this makes reachability independent of whatever either VPN server
// pushes (or doesn't) for routing, and independent of which VPN currently
// holds the default route, since a /32 host route always outranks a
// broader one. Best-effort throughout: a failure here (interface not
// found yet, DNS not resolving, setup not re-run to pick up the route
// helper) doesn't affect the VPN's own connected status - worst case,
// reachability falls back to whatever the server/OS would have done
// anyway, no worse than before this existed.
async fn add_host_routes(
    local_tunnel_ip: String,
    hostnames: Vec<String>,
    added_routes: Arc<Mutex<Vec<(String, String)>>>,
    tun_iface: Arc<Mutex<Option<String>>>,
) {
    if hostnames.is_empty() {
        return;
    }
    let Some(iface) = find_tun_interface(&local_tunnel_ip).await else {
        return;
    };
    // Published so ensure_host_route can add a route on demand later, for a
    // host that gets connected (or assigned this profile) after this
    // one-time pass already ran - see its doc comment for why that matters.
    *tun_iface.lock().unwrap() = Some(iface.clone());
    for hostname in hostnames {
        add_routes_for_hostname(&iface, &hostname, &added_routes).await;
    }
}

// Resolves `hostname` to every IPv4 address it has and adds a /32 route
// through `iface` for each - the actual per-hostname work shared by
// add_host_routes' initial bulk pass and ensure_host_route's later,
// single-host, on-demand pass.
async fn add_routes_for_hostname(
    iface: &str,
    hostname: &str,
    added_routes: &Arc<Mutex<Vec<(String, String)>>>,
) {
    if !std::path::Path::new(setup::ROUTE_HELPER_PATH).exists() {
        return;
    }
    for ip in resolve_all_ipv4(hostname).await {
        let status = tokio::process::Command::new("pkexec")
            .arg(setup::ROUTE_HELPER_PATH)
            .arg("add")
            .arg(iface)
            .arg(&ip)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .await;
        // Only remembered for later removal if it actually succeeded -
        // otherwise cleanup would try to delete a route that was never
        // added.
        if matches!(status, Ok(s) if s.success()) {
            added_routes.lock().unwrap().push((iface.to_string(), ip));
        }
    }
}

// Adds `host_id`'s /32 route on demand, for a host connected to (or
// assigned this VPN profile) after the profile's own VPN connection
// already came up. add_host_routes above only fires once, on the VPN's own
// CONNECTED transition, using whichever hosts referenced this profile at
// that exact moment - the frontend's ensureVpnUp only calls vpn::connect
// when a profile isn't already connected, so a host added afterward would
// otherwise never get a route until the VPN is manually disconnected and
// reconnected. Best-effort and idempotent like the rest of this module
// (the route helper uses `ip route replace`, safe to call repeatedly) - a
// no-op if the host has no VPN profile, that profile isn't connected, or
// the interface isn't known yet for some other best-effort reason above.
pub async fn ensure_host_route(state: &AppState, vpn_map: &VpnMap, host_id: Uuid) -> AppResult<()> {
    let host = {
        let conn = state.db.lock().unwrap();
        crate::data::hosts::get(&conn, host_id)?
    };
    let Some(profile_id) = host.vpn_profile_id else { return Ok(()) };
    let Some(entry) = vpn_map.get(&profile_id) else { return Ok(()) };
    if entry.status.lock().unwrap().state != VpnState::Connected {
        return Ok(());
    }
    let Some(iface) = entry.tun_iface.lock().unwrap().clone() else { return Ok(()) };
    let added_routes = entry.added_routes.clone();
    drop(entry); // release the DashMap shard lock before the await below
    add_routes_for_hostname(&iface, &host.hostname, &added_routes).await;
    Ok(())
}

// Finds which tun interface currently has `local_ip` assigned, by shelling
// out to `ip` (an unprivileged, read-only listing - no elevation needed).
async fn find_tun_interface(local_ip: &str) -> Option<String> {
    let output = tokio::process::Command::new("ip")
        .args(["-4", "-o", "addr", "show"])
        .output()
        .await
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    for line in text.lines() {
        // e.g. "5: tun0    inet 10.8.0.6/24 scope global tun0\       valid_lft ..."
        let cols: Vec<&str> = line.split_whitespace().collect();
        let Some(inet_pos) = cols.iter().position(|c| *c == "inet") else { continue };
        let Some(iface_pos) = inet_pos.checked_sub(1) else { continue };
        let Some(iface) = cols.get(iface_pos) else { continue };
        if !iface.starts_with("tun") {
            continue;
        }
        let Some(addr) = cols.get(inet_pos + 1) else { continue };
        if addr.split('/').next() == Some(local_ip) {
            return Some((*iface).to_string());
        }
    }
    None
}

// A bare IP resolves instantly with no network round-trip; a real hostname
// goes through the OS resolver. IPv6-only results are skipped rather than
// failed outright - the route helper only ever adds an IPv4 /32.
// A hostname behind DNS round-robin or a load-balanced service can resolve
// to more than one IPv4 address - routing only the first (as an earlier
// version of this did) leaves the others silently unrouted, so this
// resolves and returns all of them. IPv6-only results are skipped rather
// than failed outright: the route helper only supports IPv4 /32 routes
// today, and most hosts here are reached by IPv4 anyway.
async fn resolve_all_ipv4(host: &str) -> Vec<String> {
    if let Ok(v4) = host.parse::<std::net::Ipv4Addr>() {
        return vec![v4.to_string()];
    }
    // Bounded so one hostname with an unreachable/hung resolver can't stall
    // every other host in the same VPN profile's list - add_host_routes
    // resolves them one at a time, sequentially.
    let Ok(Ok(addrs)) = tokio::time::timeout(Duration::from_secs(5), tokio::net::lookup_host((host, 0))).await
    else {
        return Vec::new();
    };
    addrs
        .filter_map(|addr| match addr {
            std::net::SocketAddr::V4(v4) => Some(v4.ip().to_string()),
            std::net::SocketAddr::V6(_) => None,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_profile(config: &str, avoid_default_route: bool) -> VpnProfile {
        VpnProfile {
            id: Uuid::new_v4(),
            label: "test".into(),
            config: config.into(),
            auth_username: None,
            has_auth_password: false,
            avoid_default_route,
            created_at: "2024-01-01T00:00:00Z".into(),
        }
    }

    #[test]
    fn effective_config_appends_pull_filter_when_avoiding_default_route() {
        let profile = test_profile("client\nremote vpn.example.com 1194\n", true);
        let effective = effective_config(&profile);
        assert!(effective.starts_with(&profile.config));
        assert!(effective.contains("pull-filter ignore \"redirect-gateway\""));
    }

    #[test]
    fn effective_config_is_unchanged_when_not_avoiding_default_route() {
        let profile = test_profile("client\nremote vpn.example.com 1194\n", false);
        assert_eq!(effective_config(&profile), profile.config);
    }

    #[test]
    fn parses_connected_state_line() {
        let status = parse_management_line(">STATE:1700000000,CONNECTED,SUCCESS,10.8.0.6,203.0.113.5,1194,,").unwrap();
        assert_eq!(status.state, VpnState::Connected);
    }

    #[test]
    fn ignores_intermediate_state_lines() {
        assert!(parse_management_line(">STATE:1700000000,WAIT,,,,,,").is_none());
        assert!(parse_management_line(">STATE:1700000000,AUTH,,,,,,").is_none());
    }

    #[test]
    fn parses_fatal_line_as_error() {
        let status = parse_management_line(">FATAL:All TAP-Windows adapters are in use").unwrap();
        assert_eq!(status.state, VpnState::Error);
        assert_eq!(status.message.as_deref(), Some("All TAP-Windows adapters are in use"));
    }

    #[test]
    fn parses_auth_failure_as_error() {
        let status = parse_management_line(">PASSWORD:Verification Failed: 'Auth'").unwrap();
        assert_eq!(status.state, VpnState::Error);
    }

    #[test]
    fn ignores_unrelated_lines() {
        assert!(parse_management_line(">INFO:OpenVPN Management Interface Version 1").is_none());
        assert!(parse_management_line(">LOG:1700000000,I,some log line").is_none());
    }

    fn tracked(vpn_map: &VpnMap, state: VpnState) -> (Uuid, mpsc::UnboundedReceiver<VpnControl>) {
        let (tx, rx) = mpsc::unbounded_channel();
        let id = Uuid::new_v4();
        vpn_map.insert(
            id,
            ActiveVpn {
                commands: tx,
                status: Arc::new(Mutex::new(VpnStatus { state, message: None })),
                tun_iface: Arc::new(Mutex::new(None)),
                added_routes: Arc::new(Mutex::new(Vec::new())),
            },
        );
        (id, rx)
    }

    #[test]
    fn status_defaults_to_disconnected_when_not_tracked() {
        let vpn_map: VpnMap = Arc::new(DashMap::new());
        assert_eq!(status(&vpn_map, Uuid::new_v4()).state, VpnState::Disconnected);
    }

    #[test]
    fn disconnect_is_a_noop_when_profile_not_tracked() {
        let vpn_map: VpnMap = Arc::new(DashMap::new());
        assert!(disconnect(&vpn_map, Uuid::new_v4()).is_ok());
    }

    #[test]
    fn list_active_reports_every_tracked_profile() {
        let vpn_map: VpnMap = Arc::new(DashMap::new());
        let (id, _rx) = tracked(&vpn_map, VpnState::Connected);

        let active = list_active(&vpn_map);
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].profile_id, id);
        assert_eq!(active[0].status.state, VpnState::Connected);
    }

    #[test]
    fn disconnect_all_signals_every_tracked_profile() {
        let vpn_map: VpnMap = Arc::new(DashMap::new());
        let (_id1, mut rx1) = tracked(&vpn_map, VpnState::Connected);
        let (_id2, mut rx2) = tracked(&vpn_map, VpnState::Connecting);

        disconnect_all(&vpn_map);

        assert!(matches!(rx1.try_recv(), Ok(VpnControl::Disconnect)));
        assert!(matches!(rx2.try_recv(), Ok(VpnControl::Disconnect)));
    }

    #[test]
    fn extract_local_tunnel_ip_reads_the_fourth_field_on_connected() {
        let ip = extract_local_tunnel_ip(
            ">STATE:1700000000,CONNECTED,SUCCESS,10.8.0.6,203.0.113.5,1194,,",
        );
        assert_eq!(ip.as_deref(), Some("10.8.0.6"));
    }

    #[test]
    fn extract_local_tunnel_ip_ignores_non_connected_states() {
        assert!(extract_local_tunnel_ip(">STATE:1700000000,WAIT,,,,,,").is_none());
        assert!(extract_local_tunnel_ip(">STATE:1700000000,AUTH,,,,,,").is_none());
    }

    #[test]
    fn extract_local_tunnel_ip_ignores_unrelated_lines() {
        assert!(extract_local_tunnel_ip(">INFO:OpenVPN Management Interface Version 1").is_none());
    }

    #[tokio::test]
    async fn resolve_all_ipv4_returns_a_literal_ip_without_any_dns_lookup() {
        assert_eq!(resolve_all_ipv4("203.0.113.5").await, vec!["203.0.113.5".to_string()]);
    }

    #[tokio::test]
    async fn resolve_all_ipv4_returns_empty_for_an_unresolvable_hostname() {
        assert!(resolve_all_ipv4("this-host-does-not-exist.invalid").await.is_empty());
    }

    // The route helper is never actually installed in a test environment,
    // so remove_host_routes' own "helper missing" guard is what's exercised
    // here (no real pkexec/ip invocation happens) - this asserts the list is
    // still drained regardless, so a later call doesn't try to remove the
    // same routes twice.
    #[tokio::test]
    async fn remove_host_routes_drains_the_list_even_when_the_helper_is_not_installed() {
        let added = Arc::new(Mutex::new(vec![("tun0".to_string(), "10.0.0.5".to_string())]));
        remove_host_routes(&added).await;
        assert!(added.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn remove_host_routes_is_a_noop_on_an_empty_list() {
        let added: Arc<Mutex<Vec<(String, String)>>> = Arc::new(Mutex::new(Vec::new()));
        remove_host_routes(&added).await;
        assert!(added.lock().unwrap().is_empty());
    }

    #[test]
    fn cleanup_stale_profile_files_in_removes_every_leftover_file() {
        let dir = std::env::temp_dir().join(format!("connecthub-test-vpn-profiles-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("some-profile.ovpn"), b"client\n").unwrap();
        std::fs::write(dir.join("some-profile.auth"), b"user\npass\n").unwrap();

        cleanup_stale_profile_files_in(&dir);

        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn cleanup_stale_profile_files_in_is_a_noop_for_a_missing_directory() {
        let dir = std::env::temp_dir().join(format!("connecthub-test-vpn-profiles-missing-{}", Uuid::new_v4()));
        // Must not panic even though the directory doesn't exist.
        cleanup_stale_profile_files_in(&dir);
    }

    #[tokio::test]
    async fn add_host_routes_records_nothing_when_the_route_helper_is_not_installed() {
        let added = Arc::new(Mutex::new(Vec::new()));
        let tun_iface = Arc::new(Mutex::new(None));
        add_host_routes("10.8.0.6".into(), vec!["example.com".into()], added.clone(), tun_iface).await;
        assert!(
            added.lock().unwrap().is_empty(),
            "must not record a route it never actually added"
        );
    }

    fn build_app_state() -> AppState {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::data::init_schema(&conn).unwrap();
        AppState {
            db: std::sync::Mutex::new(conn),
            db_path: std::path::PathBuf::new(),
            vault_key: std::sync::Mutex::new(Some(crate::vault::kdf::test_key())),
            sessions: Arc::new(DashMap::new()),
            sftp_sessions: Arc::new(DashMap::new()),
            vpn_connections: Arc::new(DashMap::new()),
            google_login_cancel: std::sync::Mutex::new(None),
        }
    }

    // Creates a host with `hostname`, referencing a freshly-created VPN
    // profile - returns the host id and profile id together, since every
    // ensure_host_route test needs both.
    fn host_with_vpn_profile(state: &AppState, hostname: &str) -> (Uuid, Uuid) {
        let conn = state.db.lock().unwrap();
        let profile = state
            .with_key(|key| {
                crate::data::vpn_profiles::create(
                    &conn,
                    key,
                    crate::models::vpn_profile::VpnProfileInput {
                        label: "test profile".into(),
                        config: "client\nremote vpn.example.com 1194\n".into(),
                        auth_username: None,
                        auth_password: None,
                        avoid_default_route: true,
                    },
                )
            })
            .unwrap();
        let host = crate::data::hosts::create(
            &conn,
            crate::models::host::HostInput {
                group_id: None,
                label: "test host".into(),
                hostname: hostname.into(),
                port: 22,
                identity_id: None,
                vpn_profile_id: Some(profile.id),
                color: None,
                icon: None,
                notes: None,
                sort_order: 0,
            },
        )
        .unwrap();
        (host.id, profile.id)
    }

    #[tokio::test]
    async fn ensure_host_route_is_a_noop_when_the_profile_is_not_connected_at_all() {
        let state = build_app_state();
        let (host_id, _profile_id) = host_with_vpn_profile(&state, "10.0.0.5");
        let vpn_map: VpnMap = Arc::new(DashMap::new());

        // No entry in vpn_map for this host's profile - simulates a VPN
        // that was never connected. Must return Ok(()), not error/panic.
        assert!(ensure_host_route(&state, &vpn_map, host_id).await.is_ok());
    }

    #[tokio::test]
    async fn ensure_host_route_is_a_noop_when_the_profile_is_only_connecting() {
        let state = build_app_state();
        let (host_id, profile_id) = host_with_vpn_profile(&state, "10.0.0.5");
        let vpn_map: VpnMap = Arc::new(DashMap::new());
        let (tx, _rx) = mpsc::unbounded_channel();
        vpn_map.insert(
            profile_id,
            ActiveVpn {
                commands: tx,
                status: Arc::new(Mutex::new(VpnStatus { state: VpnState::Connecting, message: None })),
                tun_iface: Arc::new(Mutex::new(Some("tun0".into()))),
                added_routes: Arc::new(Mutex::new(Vec::new())),
            },
        );

        assert!(ensure_host_route(&state, &vpn_map, host_id).await.is_ok());
    }

    #[tokio::test]
    async fn ensure_host_route_is_a_noop_when_the_tunnel_interface_is_not_known_yet() {
        let state = build_app_state();
        let (host_id, profile_id) = host_with_vpn_profile(&state, "10.0.0.5");
        let vpn_map: VpnMap = Arc::new(DashMap::new());
        let (tx, _rx) = mpsc::unbounded_channel();
        vpn_map.insert(
            profile_id,
            ActiveVpn {
                commands: tx,
                status: Arc::new(Mutex::new(VpnStatus { state: VpnState::Connected, message: None })),
                tun_iface: Arc::new(Mutex::new(None)),
                added_routes: Arc::new(Mutex::new(Vec::new())),
            },
        );

        assert!(ensure_host_route(&state, &vpn_map, host_id).await.is_ok());
    }

    #[tokio::test]
    async fn ensure_host_route_records_nothing_when_the_route_helper_is_not_installed() {
        // Mirrors add_host_routes_records_nothing_when_the_route_helper_is_not_installed
        // above - this environment never has the real route helper
        // installed at setup::ROUTE_HELPER_PATH, so this exercises the real
        // Connected + known-interface path through to add_routes_for_hostname
        // without actually shelling out to pkexec.
        let state = build_app_state();
        let (host_id, profile_id) = host_with_vpn_profile(&state, "10.0.0.5");
        let vpn_map: VpnMap = Arc::new(DashMap::new());
        let added_routes = Arc::new(Mutex::new(Vec::new()));
        let (tx, _rx) = mpsc::unbounded_channel();
        vpn_map.insert(
            profile_id,
            ActiveVpn {
                commands: tx,
                status: Arc::new(Mutex::new(VpnStatus { state: VpnState::Connected, message: None })),
                tun_iface: Arc::new(Mutex::new(Some("tun0".into()))),
                added_routes: added_routes.clone(),
            },
        );

        assert!(ensure_host_route(&state, &vpn_map, host_id).await.is_ok());
        assert!(
            added_routes.lock().unwrap().is_empty(),
            "must not record a route it never actually added"
        );
    }

    #[test]
    fn try_claim_lets_only_one_of_many_concurrent_callers_through_for_the_same_profile() {
        // Regression test for a real race: connect()'s old "check status,
        // then later insert" pattern had async work (db reads, file
        // writes, spawning pkexec) in between, so several hosts sharing
        // one not-yet-connected VPN profile - e.g. Snippets' "run on
        // hosts" gating them all in parallel - could each observe the
        // profile as absent and each launch its own openvpn process,
        // silently overwriting each other's ActiveVpn entry in vpn_map and
        // leaking every process but the last. try_claim closes that gap by
        // making the check-and-claim a single synchronous DashMap
        // operation. Uses real OS threads (not async tasks on one runtime)
        // so the race is genuine, not just cooperative-scheduling luck.
        let vpn_map: VpnMap = Arc::new(DashMap::new());
        let profile_id = Uuid::new_v4();

        let handles: Vec<_> = (0..8)
            .map(|_| {
                let vpn_map = vpn_map.clone();
                std::thread::spawn(move || try_claim(&vpn_map, profile_id).is_ok())
            })
            .collect();
        let results: Vec<bool> = handles.into_iter().map(|h| h.join().unwrap()).collect();
        let wins = results.into_iter().filter(|won| *won).count();

        assert_eq!(
            wins, 1,
            "exactly one of several concurrent connect attempts for the same profile must \
             win the claim - any more would mean launching duplicate openvpn processes"
        );
        assert!(vpn_map.contains_key(&profile_id));
    }

    #[test]
    fn try_claim_reports_the_current_status_to_callers_that_lose_the_race() {
        let vpn_map: VpnMap = Arc::new(DashMap::new());
        let (profile_id, _rx) = tracked(&vpn_map, VpnState::Connecting);

        match try_claim(&vpn_map, profile_id) {
            Err(status) => assert_eq!(status.state, VpnState::Connecting),
            Ok(_) => panic!("must not be able to claim a profile that is already tracked"),
        }
    }
}
