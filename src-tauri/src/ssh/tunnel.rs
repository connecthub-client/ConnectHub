use std::sync::Arc;

use dashmap::DashMap;
use fast_socks5::server::{Config as Socks5Config, Socks5Socket};
use fast_socks5::util::target_addr::TargetAddr;
use russh::client::Handle;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

use super::session::{connect_and_authenticate, ClientHandler};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TunnelKind {
    Local,
    Remote,
    Dynamic,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TunnelInput {
    pub host_id: Uuid,
    pub kind: TunnelKind,
    pub bind_address: String,
    pub bind_port: u16,
    // Required for Local (where to reach, from the server) and Remote (where
    // to reach, from this client); unused for Dynamic, which gets its target
    // per-connection from the SOCKS5 handshake.
    pub target_host: Option<String>,
    pub target_port: Option<u16>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TunnelInfo {
    pub id: Uuid,
    pub host_id: Uuid,
    pub kind: TunnelKind,
    pub bind_address: String,
    pub bind_port: u16,
    pub target_host: Option<String>,
    pub target_port: Option<u16>,
}

pub struct ActiveTunnel {
    cancel: oneshot::Sender<()>,
    info: TunnelInfo,
}

pub type TunnelMap = Arc<DashMap<Uuid, ActiveTunnel>>;

fn require_target(input: &TunnelInput) -> AppResult<(String, u16)> {
    match (&input.target_host, input.target_port) {
        (Some(host), Some(port)) => Ok((host.clone(), port)),
        _ => Err(AppError::Ssh(
            "this tunnel type requires a target host and port".into(),
        )),
    }
}

pub async fn start(app: &AppState, tunnels: TunnelMap, input: TunnelInput) -> AppResult<Uuid> {
    let tunnel_id = Uuid::new_v4();
    let (cancel_tx, cancel_rx) = oneshot::channel();

    match input.kind {
        TunnelKind::Local => {
            let (target_host, target_port) = require_target(&input)?;
            let handle = connect_and_authenticate(app, input.host_id, None).await?;
            let listener = TcpListener::bind((input.bind_address.as_str(), input.bind_port)).await?;
            tokio::spawn(run_local(handle, listener, target_host, target_port, cancel_rx));
        }
        TunnelKind::Dynamic => {
            let handle = connect_and_authenticate(app, input.host_id, None).await?;
            let listener = TcpListener::bind((input.bind_address.as_str(), input.bind_port)).await?;
            tokio::spawn(run_dynamic(handle, listener, cancel_rx));
        }
        TunnelKind::Remote => {
            let (target_host, target_port) = require_target(&input)?;
            let mut handle =
                connect_and_authenticate(app, input.host_id, Some((target_host, target_port)))
                    .await?;
            handle
                .tcpip_forward(input.bind_address.clone(), input.bind_port as u32)
                .await
                .map_err(|e| AppError::Ssh(e.to_string()))?;

            let bind_address = input.bind_address.clone();
            let bind_port = input.bind_port;
            tokio::spawn(async move {
                let _ = cancel_rx.await;
                let _ = handle.cancel_tcpip_forward(bind_address, bind_port as u32).await;
                // `handle` drops here, closing the dedicated connection.
            });
        }
    }

    let info = TunnelInfo {
        id: tunnel_id,
        host_id: input.host_id,
        kind: input.kind,
        bind_address: input.bind_address,
        bind_port: input.bind_port,
        target_host: input.target_host,
        target_port: input.target_port,
    };
    tunnels.insert(tunnel_id, ActiveTunnel { cancel: cancel_tx, info });
    Ok(tunnel_id)
}

pub fn stop(tunnels: &TunnelMap, tunnel_id: Uuid) {
    if let Some((_, tunnel)) = tunnels.remove(&tunnel_id) {
        let _ = tunnel.cancel.send(());
    }
}

pub fn list(tunnels: &TunnelMap) -> Vec<TunnelInfo> {
    tunnels.iter().map(|entry| entry.info.clone()).collect()
}

async fn run_local(
    handle: Handle<ClientHandler>,
    listener: TcpListener,
    target_host: String,
    target_port: u16,
    mut cancel_rx: oneshot::Receiver<()>,
) {
    loop {
        tokio::select! {
            _ = &mut cancel_rx => break,
            accepted = listener.accept() => {
                let Ok((stream, _addr)) = accepted else { continue };
                let opened = handle
                    .channel_open_direct_tcpip(target_host.clone(), target_port as u32, "127.0.0.1", 0)
                    .await;
                if let Ok(channel) = opened {
                    tokio::spawn(async move {
                        let mut channel_stream = channel.into_stream();
                        let mut stream = stream;
                        let _ = tokio::io::copy_bidirectional(&mut channel_stream, &mut stream).await;
                    });
                }
            }
        }
    }
    // `handle` drops here, closing this tunnel's dedicated connection.
}

async fn socks5_reply(
    socket: &mut Socks5Socket<tokio::net::TcpStream, fast_socks5::server::DenyAuthentication>,
    success: bool,
) -> std::io::Result<()> {
    let code = if success {
        fast_socks5::consts::SOCKS5_REPLY_SUCCEEDED
    } else {
        fast_socks5::consts::SOCKS5_REPLY_GENERAL_FAILURE
    };
    let reply: [u8; 10] = [
        fast_socks5::consts::SOCKS5_VERSION,
        code,
        0x00,
        fast_socks5::consts::SOCKS5_ADDR_TYPE_IPV4,
        0,
        0,
        0,
        0,
        0,
        0,
    ];
    socket.write_all(&reply).await
}

async fn run_dynamic(handle: Handle<ClientHandler>, listener: TcpListener, mut cancel_rx: oneshot::Receiver<()>) {
    let mut config = Socks5Config::default();
    // We do our own connecting (through the SSH channel) rather than letting
    // the library dial out directly, and let the SSH server resolve domain
    // names rather than resolving them ourselves - matching `ssh -D`.
    config.set_execute_command(false);
    config.set_dns_resolve(false);
    let config = Arc::new(config);

    loop {
        tokio::select! {
            _ = &mut cancel_rx => break,
            accepted = listener.accept() => {
                let Ok((stream, _addr)) = accepted else { continue };
                let config = config.clone();

                let socks = Socks5Socket::new(stream, config);
                let mut socks = match socks.upgrade_to_socks5().await {
                    Ok(s) => s,
                    Err(_) => continue,
                };

                let target = match socks.target_addr() {
                    Some(TargetAddr::Ip(addr)) => Some((addr.ip().to_string(), addr.port())),
                    Some(TargetAddr::Domain(host, port)) => Some((host.clone(), *port)),
                    None => None,
                };
                let Some((host, port)) = target else { continue };

                match handle.channel_open_direct_tcpip(host, port as u32, "127.0.0.1", 0).await {
                    Ok(channel) => {
                        if socks5_reply(&mut socks, true).await.is_err() {
                            continue;
                        }
                        let raw = socks.into_inner();
                        tokio::spawn(async move {
                            let mut channel_stream = channel.into_stream();
                            let mut raw = raw;
                            let _ = tokio::io::copy_bidirectional(&mut channel_stream, &mut raw).await;
                        });
                    }
                    Err(_) => {
                        let _ = socks5_reply(&mut socks, false).await;
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod live_sshd_tests {
    // Manual, environment-dependent check against the real local sshd - see
    // ssh::session::live_sshd_tests for the rationale (run with --ignored).
    // Each tunnel kind is verified by reading the real SSH banner ("SSH-2.0-...")
    // back through it from the same sshd the tunnel routes through/to.
    use super::*;
    use crate::data::{hosts, identities, ssh_keys};
    use crate::models::host::HostInput;
    use crate::models::identity::{AuthMethod, IdentityInput};
    use crate::models::ssh_key::ImportKeyInput;
    use crate::state::AppState;
    use crate::vault::kdf::test_key;
    use tokio::io::AsyncReadExt;
    use tokio::net::TcpStream;

    fn tempfile_dir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join("sshtool-live-test");
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    async fn build_app_state() -> AppState {
        let test_key_path =
            "/tmp/claude-1000/-home-mashhoud-NGI--workSpace-SSH-tool/cb0c64d1-0315-48de-86ae-3782252496ca/scratchpad/testkey/id_ed25519";
        let pem = std::fs::read_to_string(test_key_path).expect("test key not found");
        let username = std::env::var("USER").expect("USER env var not set");

        let db_dir = tempfile_dir();
        let db_path = db_dir.join(format!("tunnel_flow_{}.db", Uuid::new_v4()));
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        crate::data::init_schema(&conn).unwrap();
        crate::ssh::known_hosts::init_schema(&conn).unwrap();

        let vault_key = test_key();

        let ssh_key = ssh_keys::import(
            &conn,
            &vault_key,
            ImportKeyInput {
                label: "tunnel live test key".into(),
                private_key_pem: pem,
                passphrase: None,
            },
        )
        .unwrap();

        let identity = identities::create(
            &conn,
            &vault_key,
            IdentityInput {
                label: "tunnel live test identity".into(),
                username,
                auth_method: AuthMethod::PrivateKey,
                ssh_key_id: Some(ssh_key.id),
                password: None,
            },
        )
        .unwrap();

        hosts::create(
            &conn,
            HostInput {
                group_id: None,
                label: "loopback".into(),
                hostname: "127.0.0.1".into(),
                port: 22,
                identity_id: Some(identity.id),
                jump_host_id: None,
                color: None,
                notes: None,
                sort_order: 0,
            },
        )
        .unwrap();

        AppState {
            db: std::sync::Mutex::new(conn),
            db_path: db_path.clone(),
            vault_key: std::sync::Mutex::new(Some(vault_key)),
            sessions: Arc::new(DashMap::new()),
            sftp_sessions: Arc::new(DashMap::new()),
            tunnels: Arc::new(DashMap::new()),
        }
    }

    fn host_id_of(app: &AppState) -> Uuid {
        let conn = app.db.lock().unwrap();
        hosts::list(&conn).unwrap()[0].id
    }

    async fn read_ssh_banner(stream: &mut TcpStream) -> String {
        let mut buf = [0u8; 32];
        let n = tokio::time::timeout(std::time::Duration::from_secs(5), stream.read(&mut buf))
            .await
            .expect("timed out waiting for banner")
            .expect("read failed");
        String::from_utf8_lossy(&buf[..n]).to_string()
    }

    #[tokio::test]
    #[ignore]
    async fn local_forward_reaches_real_sshd() {
        let app = build_app_state().await;
        let host_id = host_id_of(&app);
        let tunnels: TunnelMap = app.tunnels.clone();

        let tunnel_id = start(
            &app,
            tunnels.clone(),
            TunnelInput {
                host_id,
                kind: TunnelKind::Local,
                bind_address: "127.0.0.1".into(),
                bind_port: 18022,
                target_host: Some("127.0.0.1".into()),
                target_port: Some(22),
            },
        )
        .await
        .expect("failed to start local tunnel");

        tokio::time::sleep(std::time::Duration::from_millis(200)).await;

        let mut stream = TcpStream::connect(("127.0.0.1", 18022))
            .await
            .expect("failed to connect through local tunnel");
        let banner = read_ssh_banner(&mut stream).await;
        assert!(banner.starts_with("SSH-"), "unexpected banner: {banner}");

        stop(&tunnels, tunnel_id);
    }

    #[tokio::test]
    #[ignore]
    async fn dynamic_forward_reaches_real_sshd_via_socks5() {
        let app = build_app_state().await;
        let host_id = host_id_of(&app);
        let tunnels: TunnelMap = app.tunnels.clone();

        let tunnel_id = start(
            &app,
            tunnels.clone(),
            TunnelInput {
                host_id,
                kind: TunnelKind::Dynamic,
                bind_address: "127.0.0.1".into(),
                bind_port: 18023,
                target_host: None,
                target_port: None,
            },
        )
        .await
        .expect("failed to start dynamic tunnel");

        tokio::time::sleep(std::time::Duration::from_millis(200)).await;

        let socks_stream = fast_socks5::client::Socks5Stream::connect(
            ("127.0.0.1", 18023),
            "127.0.0.1".to_string(),
            22,
            fast_socks5::client::Config::default(),
        )
        .await
        .expect("socks5 connect failed");

        let mut stream = socks_stream.get_socket();
        let banner = read_ssh_banner(&mut stream).await;
        assert!(banner.starts_with("SSH-"), "unexpected banner: {banner}");

        stop(&tunnels, tunnel_id);
    }

    #[tokio::test]
    #[ignore]
    async fn remote_forward_reaches_real_sshd() {
        let app = build_app_state().await;
        let host_id = host_id_of(&app);
        let tunnels: TunnelMap = app.tunnels.clone();

        let tunnel_id = start(
            &app,
            tunnels.clone(),
            TunnelInput {
                host_id,
                kind: TunnelKind::Remote,
                bind_address: "127.0.0.1".into(),
                bind_port: 18024,
                target_host: Some("127.0.0.1".into()),
                target_port: Some(22),
            },
        )
        .await
        .expect("failed to start remote tunnel");

        tokio::time::sleep(std::time::Duration::from_millis(200)).await;

        let mut stream = TcpStream::connect(("127.0.0.1", 18024))
            .await
            .expect("failed to connect through remote tunnel");
        let banner = read_ssh_banner(&mut stream).await;
        assert!(banner.starts_with("SSH-"), "unexpected banner: {banner}");

        stop(&tunnels, tunnel_id);
    }
}
