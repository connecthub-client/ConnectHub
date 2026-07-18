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
        if matches!(current.state, VpnState::Connecting | VpnState::Connected) {
            return Ok(current);
        }
    }

    if !setup::is_installed() {
        return Err(AppError::Vpn(
            "VPN privilege setup hasn't been run yet - open the VPN tab and run setup first"
                .into(),
        ));
    }

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

    let (control_tx, control_rx) = mpsc::unbounded_channel();
    let status = Arc::new(Mutex::new(VpnStatus { state: VpnState::Connecting, message: None }));
    let (ready_tx, ready_rx) = oneshot::channel();

    vpn_map.insert(profile_id, ActiveVpn { commands: control_tx, status: status.clone() });

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
        cleanup(&vpn_map, profile_id, &config_path, &auth_path).await;
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
                                    tokio::spawn(add_host_routes(local_ip, hostnames));
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
    cleanup(&vpn_map, profile_id, &config_path, &auth_path).await;
}

async fn cleanup(vpn_map: &VpnMap, profile_id: Uuid, config_path: &Path, auth_path: &Option<PathBuf>) {
    vpn_map.remove(&profile_id);
    let _ = tokio::fs::remove_file(config_path).await;
    if let Some(p) = auth_path {
        let _ = tokio::fs::remove_file(p).await;
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
async fn add_host_routes(local_tunnel_ip: String, hostnames: Vec<String>) {
    if hostnames.is_empty() {
        return;
    }
    if !std::path::Path::new(setup::ROUTE_HELPER_PATH).exists() {
        return;
    }
    let Some(iface) = find_tun_interface(&local_tunnel_ip).await else {
        return;
    };
    for hostname in hostnames {
        if let Some(ip) = resolve_ipv4(&hostname).await {
            let _ = tokio::process::Command::new("pkexec")
                .arg(setup::ROUTE_HELPER_PATH)
                .arg("add")
                .arg(&iface)
                .arg(&ip)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .await;
        }
    }
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
async fn resolve_ipv4(host: &str) -> Option<String> {
    if host.parse::<std::net::Ipv4Addr>().is_ok() {
        return Some(host.to_string());
    }
    let addrs = tokio::net::lookup_host((host, 0)).await.ok()?;
    for addr in addrs {
        if let std::net::SocketAddr::V4(v4) = addr {
            return Some(v4.ip().to_string());
        }
    }
    None
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
        vpn_map.insert(id, ActiveVpn { commands: tx, status: Arc::new(Mutex::new(VpnStatus { state, message: None })) });
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
    async fn resolve_ipv4_returns_a_literal_ip_without_any_dns_lookup() {
        assert_eq!(resolve_ipv4("203.0.113.5").await.as_deref(), Some("203.0.113.5"));
    }
}
