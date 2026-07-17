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

    let dir = profiles_dir()?;
    let config_path = dir.join(format!("{profile_id}.ovpn"));
    write_private_file(&config_path, &profile.config)?;

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
                            *status.lock().unwrap() = update.clone();
                            if matches!(update.state, VpnState::Connected | VpnState::Error) {
                                if let Some(tx) = ready_tx.take() {
                                    let _ = tx.send(update);
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
