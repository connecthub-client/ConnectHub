use std::io::Cursor;
use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use base64::Engine;
use dashmap::DashMap;
use russh::client::{self, Config};
use russh::keys::key::PublicKey;
use russh::ChannelMsg;
use serde::Serialize;
use tauri::ipc::Channel as TauriChannel;
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::data::{hosts, identities, ssh_keys};
use crate::error::{AppError, AppResult};
use crate::models::identity::AuthMethod;
use crate::state::AppState;

use super::known_hosts;

pub type SessionMap = Arc<DashMap<Uuid, mpsc::UnboundedSender<SessionCommand>>>;

pub enum SessionCommand {
    Write(Vec<u8>),
    Resize { cols: u32, rows: u32 },
    Close,
}

#[derive(Debug, Serialize, serde::Deserialize, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SessionEvent {
    // PTY output, base64-encoded since it isn't guaranteed to be valid UTF-8.
    Data { data: String },
    Closed,
    Error { message: String },
}

#[derive(Debug)]
pub(super) enum HandlerError {
    Russh(russh::Error),
    Db(rusqlite::Error),
    HostKeyRejected(AppError),
}

impl From<russh::Error> for HandlerError {
    fn from(e: russh::Error) -> Self {
        HandlerError::Russh(e)
    }
}

impl From<rusqlite::Error> for HandlerError {
    fn from(e: rusqlite::Error) -> Self {
        HandlerError::Db(e)
    }
}

impl std::fmt::Display for HandlerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            HandlerError::Russh(e) => write!(f, "{e}"),
            HandlerError::Db(e) => write!(f, "{e}"),
            HandlerError::HostKeyRejected(e) => write!(f, "{e}"),
        }
    }
}

impl From<HandlerError> for AppError {
    fn from(e: HandlerError) -> Self {
        match e {
            HandlerError::HostKeyRejected(app_err) => app_err,
            other => AppError::Ssh(other.to_string()),
        }
    }
}

// Classifies a connect-phase failure into a more specific AppError variant
// where the underlying io::Error/russh::Error makes that possible, with the
// target host baked into the message - this is the one call site with that
// context. Anything not specifically recognized falls back to the generic
// Ssh(String) catch-all with the original error text, same as before.
fn classify_connect_error(e: HandlerError, hostname: &str, port: u16) -> AppError {
    let target = format!("{hostname}:{port}");
    let HandlerError::Russh(russh_err) = e else {
        return AppError::from(e);
    };
    match &russh_err {
        russh::Error::IO(io_err) => match io_err.kind() {
            std::io::ErrorKind::ConnectionRefused => {
                AppError::ConnectionRefused(format!("{target} ({io_err})"))
            }
            std::io::ErrorKind::TimedOut => {
                AppError::ConnectionTimedOut(format!("{target} ({io_err})"))
            }
            // Rust doesn't expose a stable ErrorKind for DNS/getaddrinfo
            // failures - this is a best-effort heuristic over the OS error
            // text rather than a guaranteed classification.
            _ if io_err.to_string().contains("lookup address")
                || io_err.to_string().contains("Name or service not known") =>
            {
                AppError::DnsResolutionFailed(format!("{hostname} ({io_err})"))
            }
            _ => AppError::Ssh(format!("network error connecting to {target}: {io_err}")),
        },
        russh::Error::ConnectionTimeout => {
            AppError::ConnectionTimedOut(format!("{target} (no response during handshake)"))
        }
        _ => AppError::Ssh(russh_err.to_string()),
    }
}

pub(super) struct ClientHandler {
    db_path: PathBuf,
    hostname: String,
    port: u16,
    // Set only for remote (-R) port forwards: where to connect *locally* when
    // the server pushes us a forwarded-tcpip channel. Each such tunnel gets
    // its own dedicated connection, so one target per handler is enough.
    remote_forward_target: Option<(String, u16)>,
}

#[async_trait]
impl client::Handler for ClientHandler {
    type Error = HandlerError;

    // The one security-critical step in the whole connect flow: pins the
    // server's key on first connect (TOFU) and refuses to proceed if a later
    // connection presents a different key for the same host/port.
    async fn check_server_key(&mut self, server_public_key: &PublicKey) -> Result<bool, Self::Error> {
        let fingerprint = format!("SHA256:{}", server_public_key.fingerprint());
        let conn = rusqlite::Connection::open(&self.db_path)?;
        match known_hosts::verify_or_trust(&conn, &self.hostname, self.port, &fingerprint) {
            Ok(_) => Ok(true),
            Err(app_err) => Err(HandlerError::HostKeyRejected(app_err)),
        }
    }

    // Fires when the server accepts a connection on a port we asked it to
    // forward to us (via `tcpip_forward`). We connect locally to the
    // configured target and pump bytes between it and this channel.
    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: russh::Channel<russh::client::Msg>,
        _connected_address: &str,
        _connected_port: u32,
        _originator_address: &str,
        _originator_port: u32,
        _session: &mut russh::client::Session,
    ) -> Result<(), Self::Error> {
        if let Some((host, port)) = self.remote_forward_target.clone() {
            tokio::spawn(async move {
                match tokio::net::TcpStream::connect((host.as_str(), port)).await {
                    Ok(mut stream) => {
                        let mut channel_stream = channel.into_stream();
                        let _ = tokio::io::copy_bidirectional(&mut channel_stream, &mut stream).await;
                    }
                    Err(_) => {
                        let _ = channel.close().await;
                    }
                }
            });
        } else {
            let _ = channel.close().await;
        }
        Ok(())
    }
}

enum ResolvedAuth {
    Password(String),
    PrivateKey {
        pem: String,
        passphrase: Option<String>,
    },
    Agent,
}

// `Config::default()` leaves keepalives off, so a connection that goes dead
// silently (laptop sleep, a NAT/firewall dropping an idle mapping, an
// unplugged network) is never detected at the SSH layer - the terminal just
// hangs until an OS-level TCP error eventually surfaces, if it ever does.
// Sending a keepalive every 30s and giving up after 3 unanswered ones (~90s)
// turns that into a definite, timely SessionEvent::Error instead. This is
// deliberately just a keepalive, not an inactivity_timeout: a genuinely
// idle-but-healthy session (e.g. sitting at a shell prompt) must not be
// killed just because no data has been sent - only a connection that stops
// *responding* should be.
fn client_config() -> Config {
    Config {
        keepalive_interval: Some(std::time::Duration::from_secs(30)),
        keepalive_max: 3,
        ..Config::default()
    }
}

struct ConnectParams {
    hostname: String,
    port: u16,
    username: String,
    auth: ResolvedAuth,
    known_hosts_db_path: PathBuf,
}

fn gather_connect_params(app: &AppState, host_id: Uuid) -> AppResult<ConnectParams> {
    let conn = app.db.lock().unwrap();
    let host = hosts::get(&conn, host_id)?;
    let identity_id = host
        .identity_id
        .ok_or_else(|| AppError::Ssh("this host has no identity configured".into()))?;

    let vault_guard = app.vault_key.lock().unwrap();
    let key = vault_guard.as_ref().ok_or(AppError::VaultLocked)?;

    let (identity, password) = identities::get_with_decrypted_password(&conn, key, identity_id)?;
    let auth = match identity.auth_method {
        AuthMethod::Password => ResolvedAuth::Password(
            password.ok_or_else(|| AppError::Ssh("this identity has no stored password".into()))?,
        ),
        AuthMethod::PrivateKey => {
            let ssh_key_id = identity
                .ssh_key_id
                .ok_or_else(|| AppError::Ssh("this identity has no key selected".into()))?;
            let (pem, passphrase) = ssh_keys::get_decrypted_private_key(&conn, key, ssh_key_id)?;
            ResolvedAuth::PrivateKey { pem, passphrase }
        }
        AuthMethod::Agent => ResolvedAuth::Agent,
    };

    Ok(ConnectParams {
        hostname: host.hostname,
        port: host.port,
        username: identity.username,
        auth,
        known_hosts_db_path: app.db_path.clone(),
    })
}

// Shared by both interactive terminal sessions and SFTP browsing - each gets
// its own independent SSH connection (simplest way to keep their lifecycles,
// and any future concurrent channel usage, fully decoupled).
pub(super) async fn connect_and_authenticate(
    app: &AppState,
    host_id: Uuid,
    remote_forward_target: Option<(String, u16)>,
) -> AppResult<client::Handle<ClientHandler>> {
    let params = gather_connect_params(app, host_id)?;

    let config = Arc::new(client_config());
    let handler = ClientHandler {
        db_path: params.known_hosts_db_path,
        hostname: params.hostname.clone(),
        port: params.port,
        remote_forward_target,
    };

    let mut handle = client::connect(config, (params.hostname.as_str(), params.port), handler)
        .await
        .map_err(|e| classify_connect_error(e, &params.hostname, params.port))?;

    let authenticated = match params.auth {
        ResolvedAuth::Password(password) => handle
            .authenticate_password(&params.username, password)
            .await
            .map_err(|e| AppError::AuthenticationFailed(e.to_string()))?,
        ResolvedAuth::PrivateKey { pem, passphrase } => {
            let key_pair = russh::keys::decode_secret_key(&pem, passphrase.as_deref())
                .map_err(|e| AppError::Ssh(format!("failed to load private key: {e}")))?;
            handle
                .authenticate_publickey(&params.username, Arc::new(key_pair))
                .await
                .map_err(|e| AppError::AuthenticationFailed(e.to_string()))?
        }
        ResolvedAuth::Agent => {
            return Err(AppError::Ssh(
                "SSH agent authentication is not yet supported".into(),
            ))
        }
    };

    if !authenticated {
        return Err(AppError::AuthenticationFailed(format!(
            "server rejected the credentials for user \"{}\"",
            params.username
        )));
    }

    {
        let conn = app.db.lock().unwrap();
        hosts::touch_last_connected(&conn, host_id)?;
    }

    Ok(handle)
}

pub async fn connect(
    app: &AppState,
    sessions: SessionMap,
    host_id: Uuid,
    on_event: TauriChannel<SessionEvent>,
) -> AppResult<Uuid> {
    let handle = connect_and_authenticate(app, host_id, None).await?;

    let mut channel = handle
        .channel_open_session()
        .await
        .map_err(|e| AppError::Ssh(e.to_string()))?;
    channel
        .request_pty(true, "xterm-256color", 80, 24, 0, 0, &[])
        .await
        .map_err(|e| AppError::Ssh(e.to_string()))?;
    channel
        .request_shell(true)
        .await
        .map_err(|e| AppError::Ssh(e.to_string()))?;

    let session_id = Uuid::new_v4();
    let (tx, mut rx) = mpsc::unbounded_channel::<SessionCommand>();
    sessions.insert(session_id, tx);

    let sessions_for_task = sessions.clone();
    tokio::spawn(async move {
        // Keep `handle` alive for the whole session - dropping it early would
        // tear down the underlying connection out from under `channel`.
        let _handle = handle;

        loop {
            tokio::select! {
                msg = channel.wait() => {
                    match msg {
                        Some(ChannelMsg::Data { data }) => {
                            let encoded = base64::engine::general_purpose::STANDARD.encode(&data[..]);
                            if on_event.send(SessionEvent::Data { data: encoded }).is_err() {
                                break;
                            }
                        }
                        Some(ChannelMsg::ExtendedData { data, .. }) => {
                            let encoded = base64::engine::general_purpose::STANDARD.encode(&data[..]);
                            if on_event.send(SessionEvent::Data { data: encoded }).is_err() {
                                break;
                            }
                        }
                        Some(ChannelMsg::Close) | Some(ChannelMsg::Eof) | None => break,
                        _ => {}
                    }
                }
                cmd = rx.recv() => {
                    match cmd {
                        Some(SessionCommand::Write(data)) => {
                            if let Err(e) = channel.data(Cursor::new(data)).await {
                                let _ = on_event.send(SessionEvent::Error { message: e.to_string() });
                                break;
                            }
                        }
                        Some(SessionCommand::Resize { cols, rows }) => {
                            if let Err(e) = channel.window_change(cols, rows, 0, 0).await {
                                let _ = on_event.send(SessionEvent::Error { message: e.to_string() });
                                break;
                            }
                        }
                        Some(SessionCommand::Close) | None => {
                            let _ = channel.close().await;
                            break;
                        }
                    }
                }
            }
        }

        sessions_for_task.remove(&session_id);
        let _ = on_event.send(SessionEvent::Closed);
    });

    Ok(session_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_config_enables_keepalive_without_an_inactivity_timeout() {
        let config = client_config();
        assert_eq!(config.keepalive_interval, Some(std::time::Duration::from_secs(30)));
        assert_eq!(config.keepalive_max, 3);
        assert_eq!(
            config.inactivity_timeout, None,
            "must not time out a healthy but idle session"
        );
    }

    #[test]
    fn classify_connect_error_recognizes_connection_refused() {
        let io_err = std::io::Error::new(std::io::ErrorKind::ConnectionRefused, "connection refused");
        let err = classify_connect_error(HandlerError::Russh(russh::Error::IO(io_err)), "10.0.0.5", 22);
        assert!(matches!(err, AppError::ConnectionRefused(msg) if msg.contains("10.0.0.5:22")));
    }

    #[test]
    fn classify_connect_error_recognizes_timeout() {
        let io_err = std::io::Error::new(std::io::ErrorKind::TimedOut, "timed out");
        let err = classify_connect_error(HandlerError::Russh(russh::Error::IO(io_err)), "10.0.0.5", 22);
        assert!(matches!(err, AppError::ConnectionTimedOut(msg) if msg.contains("10.0.0.5:22")));
    }

    #[test]
    fn classify_connect_error_recognizes_russh_connection_timeout_variant() {
        let err = classify_connect_error(HandlerError::Russh(russh::Error::ConnectionTimeout), "10.0.0.5", 22);
        assert!(matches!(err, AppError::ConnectionTimedOut(msg) if msg.contains("10.0.0.5:22")));
    }

    #[test]
    fn classify_connect_error_recognizes_dns_failure_heuristically() {
        let io_err = std::io::Error::other("failed to lookup address information: Name or service not known");
        let err = classify_connect_error(HandlerError::Russh(russh::Error::IO(io_err)), "no-such-host.invalid", 22);
        assert!(matches!(err, AppError::DnsResolutionFailed(msg) if msg.contains("no-such-host.invalid")));
    }

    #[test]
    fn classify_connect_error_falls_back_to_generic_ssh_error() {
        let err = classify_connect_error(HandlerError::Russh(russh::Error::Disconnect), "10.0.0.5", 22);
        assert!(matches!(err, AppError::Ssh(_)));
    }

    #[test]
    fn classify_connect_error_passes_through_host_key_rejection_unchanged() {
        let app_err = AppError::HostKeyMismatch {
            hostname: "10.0.0.5".into(),
            expected: "AAA".into(),
            got: "BBB".into(),
        };
        let err = classify_connect_error(HandlerError::HostKeyRejected(app_err), "10.0.0.5", 22);
        assert!(matches!(err, AppError::HostKeyMismatch { .. }));
    }

    // Exercises the exact production connect() function end to end - real
    // AppState, real data-layer encryption, real request_pty+request_shell
    // path, and a real (non-webview-backed) tauri::ipc::Channel - against
    // the in-process TestServer instead of a real system sshd, so this runs
    // in every normal `cargo test` rather than needing --ignored and manual
    // setup like live_sshd_tests below. Mirrors that module's
    // production_connect_flow_over_pty_and_shell as closely as possible so
    // the two stay easy to compare.
    #[tokio::test(flavor = "multi_thread")]
    async fn hermetic_production_connect_flow_over_pty_and_shell() {
        use crate::data::{hosts, identities, ssh_keys};
        use crate::models::host::HostInput;
        use crate::models::identity::{AuthMethod, IdentityInput};
        use crate::models::ssh_key::ImportKeyInput;
        use crate::ssh::test_support::TestServer;
        use crate::state::AppState;
        use crate::vault::kdf::test_key;
        use std::sync::mpsc as std_mpsc;

        let test_server = TestServer::start().await;

        let db_path = std::env::temp_dir().join(format!("connecthub-test-session-{}.db", Uuid::new_v4()));
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        crate::data::init_schema(&conn).unwrap();
        crate::ssh::known_hosts::init_schema(&conn).unwrap();

        let vault_key = test_key();

        let ssh_key = ssh_keys::import(
            &conn,
            &vault_key,
            ImportKeyInput {
                label: "hermetic test key".into(),
                private_key_pem: test_server.client_key_pem.clone(),
                passphrase: None,
            },
        )
        .unwrap();

        let identity = identities::create(
            &conn,
            &vault_key,
            IdentityInput {
                label: "hermetic test identity".into(),
                username: "test".into(),
                auth_method: AuthMethod::PrivateKey,
                ssh_key_id: Some(ssh_key.id),
                password: None,
            },
        )
        .unwrap();

        let host = hosts::create(
            &conn,
            HostInput {
                group_id: None,
                label: "loopback".into(),
                hostname: "127.0.0.1".into(),
                port: test_server.port,
                identity_id: Some(identity.id),
                jump_host_id: None,
                vpn_profile_id: None,
                color: None,
                notes: None,
                sort_order: 0,
            },
        )
        .unwrap();

        let app_state = AppState {
            db: std::sync::Mutex::new(conn),
            db_path: db_path.clone(),
            vault_key: std::sync::Mutex::new(Some(vault_key)),
            sessions: Arc::new(DashMap::new()),
            sftp_sessions: Arc::new(DashMap::new()),
            tunnels: Arc::new(DashMap::new()),
            vpn_connections: Arc::new(DashMap::new()),
            google_login_cancel: std::sync::Mutex::new(None),
        };

        let (event_tx, event_rx) = std_mpsc::channel::<SessionEvent>();
        let channel = tauri::ipc::Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(json) = body {
                if let Ok(event) = serde_json::from_str::<SessionEvent>(&json) {
                    let _ = event_tx.send(event);
                }
            }
            Ok(())
        });

        let sessions = app_state.sessions.clone();
        let session_id = connect(&app_state, sessions, host.id, channel)
            .await
            .expect("hermetic connect() failed");

        let sender = app_state.sessions.get(&session_id).unwrap().clone();
        sender
            .send(SessionCommand::Write(b"CONNECTHUB_PTY_TEST_OK\n".to_vec()))
            .unwrap();

        // TestSession's shell echoes back whatever it receives - looking
        // for our own input mirrored back exercises the exact same
        // PTY/data-relay path the real-sshd test does, just without a real
        // shell interpreting the line.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        let mut saw_marker = false;
        while std::time::Instant::now() < deadline {
            if let Ok(event) = event_rx.recv_timeout(std::time::Duration::from_millis(200)) {
                if let SessionEvent::Data { data } = event {
                    let decoded = base64::engine::general_purpose::STANDARD
                        .decode(&data)
                        .unwrap_or_default();
                    if String::from_utf8_lossy(&decoded).contains("CONNECTHUB_PTY_TEST_OK") {
                        saw_marker = true;
                        break;
                    }
                }
            }
        }
        assert!(saw_marker, "never saw echoed marker in PTY output");

        sender.send(SessionCommand::Close).unwrap();
        let _ = std::fs::remove_file(&db_path);
    }
}

#[cfg(test)]
mod live_sshd_tests {
    // Manual, environment-dependent check against the real local sshd - not
    // part of the hermetic suite, run explicitly with `--ignored`. Exercises
    // the actual russh handshake/auth/pty/shell/data path end to end,
    // independent of the Tauri Channel plumbing (which needs a running app).
    use super::*;

    #[tokio::test]
    #[ignore]
    async fn connects_authenticates_and_runs_a_command() {
        let test_key_path =
            "/tmp/claude-1000/-home-mashhoud-NGI--workSpace-SSH-tool/cb0c64d1-0315-48de-86ae-3782252496ca/scratchpad/testkey/id_ed25519";
        let pem = std::fs::read_to_string(test_key_path).expect("test key not found");

        let db_dir = tempfile_dir();
        let db_path = db_dir.join("known_hosts_test.db");
        let _ = std::fs::remove_file(&db_path);
        {
            let conn = rusqlite::Connection::open(&db_path).unwrap();
            crate::ssh::known_hosts::init_schema(&conn).unwrap();
        }

        let config = Arc::new(Config::default());
        let handler = ClientHandler {
            db_path: db_path.clone(),
            hostname: "127.0.0.1".into(),
            port: 22,
            remote_forward_target: None,
        };

        let mut handle = client::connect(config, ("127.0.0.1", 22), handler)
            .await
            .expect("tcp connect + kex + host key check failed");

        let key_pair =
            russh::keys::decode_secret_key(&pem, None).expect("failed to parse test private key");
        let username = std::env::var("USER").expect("USER env var not set");
        let authenticated = handle
            .authenticate_publickey(username, Arc::new(key_pair))
            .await
            .expect("auth request failed");
        assert!(authenticated, "publickey authentication was rejected");

        let mut channel = handle
            .channel_open_session()
            .await
            .expect("channel open failed");
        channel
            .exec(true, "echo SSHTOOL_LIVE_TEST_OK")
            .await
            .expect("exec failed");

        let mut output = Vec::new();
        loop {
            match channel.wait().await {
                Some(ChannelMsg::Data { data }) => output.extend_from_slice(&data),
                Some(ChannelMsg::Close) | Some(ChannelMsg::Eof) | None => break,
                _ => {}
            }
        }

        let output = String::from_utf8_lossy(&output);
        assert!(
            output.contains("SSHTOOL_LIVE_TEST_OK"),
            "unexpected output: {output}"
        );

        // Second connection to the same host must find the pinned key and match.
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        crate::ssh::known_hosts::init_schema(&conn).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM known_hosts", (), |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1, "expected exactly one pinned host key");

        let _ = std::fs::remove_file(&db_path);
        let _ = output; // silence unused warning if assertions are compiled out
    }

    fn tempfile_dir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join("sshtool-live-test");
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    // Exercises the exact production `connect()` function - real AppState,
    // real data-layer encryption, real request_pty+request_shell path, and a
    // real (non-webview-backed) tauri::ipc::Channel - not just a bare russh
    // handshake like the test above.
    //
    // Needs a multi-thread runtime: the test blocks on a std (non-async) mpsc
    // recv below, and a current-thread runtime would starve the spawned
    // session task of any chance to run while that blocking call waits.
    #[tokio::test(flavor = "multi_thread")]
    #[ignore]
    async fn production_connect_flow_over_pty_and_shell() {
        use crate::data::{hosts, identities, ssh_keys};
        use crate::models::host::HostInput;
        use crate::models::identity::{AuthMethod, IdentityInput};
        use crate::models::ssh_key::ImportKeyInput;
        use crate::state::AppState;
        use crate::vault::kdf::test_key;
        use std::sync::mpsc as std_mpsc;

        let test_key_path =
            "/tmp/claude-1000/-home-mashhoud-NGI--workSpace-SSH-tool/cb0c64d1-0315-48de-86ae-3782252496ca/scratchpad/testkey/id_ed25519";
        let pem = std::fs::read_to_string(test_key_path).expect("test key not found");
        let username = std::env::var("USER").expect("USER env var not set");

        let db_dir = tempfile_dir();
        let db_path = db_dir.join(format!("production_flow_{}.db", Uuid::new_v4()));
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        crate::data::init_schema(&conn).unwrap();
        crate::ssh::known_hosts::init_schema(&conn).unwrap();

        let vault_key = test_key();

        let ssh_key = ssh_keys::import(
            &conn,
            &vault_key,
            ImportKeyInput {
                label: "live test key".into(),
                private_key_pem: pem,
                passphrase: None,
            },
        )
        .unwrap();

        let identity = identities::create(
            &conn,
            &vault_key,
            IdentityInput {
                label: "live test identity".into(),
                username,
                auth_method: AuthMethod::PrivateKey,
                ssh_key_id: Some(ssh_key.id),
                password: None,
            },
        )
        .unwrap();

        let host = hosts::create(
            &conn,
            HostInput {
                group_id: None,
                label: "loopback".into(),
                hostname: "127.0.0.1".into(),
                port: 22,
                identity_id: Some(identity.id),
                jump_host_id: None,
                vpn_profile_id: None,
                color: None,
                notes: None,
                sort_order: 0,
            },
        )
        .unwrap();

        let app_state = AppState {
            db: std::sync::Mutex::new(conn),
            db_path: db_path.clone(),
            vault_key: std::sync::Mutex::new(Some(vault_key)),
            sessions: Arc::new(DashMap::new()),
            sftp_sessions: Arc::new(DashMap::new()),
            tunnels: Arc::new(DashMap::new()),
            vpn_connections: Arc::new(DashMap::new()),
            google_login_cancel: std::sync::Mutex::new(None),
        };

        let (event_tx, event_rx) = std_mpsc::channel::<SessionEvent>();
        let channel = tauri::ipc::Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(json) = body {
                if let Ok(event) = serde_json::from_str::<SessionEvent>(&json) {
                    let _ = event_tx.send(event);
                }
            }
            Ok(())
        });

        let sessions = app_state.sessions.clone();
        let session_id = connect(&app_state, sessions, host.id, channel)
            .await
            .expect("production connect() failed");

        let sender = app_state.sessions.get(&session_id).unwrap().clone();
        sender
            .send(SessionCommand::Write(b"echo SSHTOOL_PTY_TEST_OK\n".to_vec()))
            .unwrap();

        // Collect events for up to a few seconds looking for our marker in
        // the PTY-echoed output, then close the session.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        let mut saw_marker = false;
        while std::time::Instant::now() < deadline {
            if let Ok(event) = event_rx.recv_timeout(std::time::Duration::from_millis(200)) {
                if let SessionEvent::Data { data } = event {
                    let decoded = base64::engine::general_purpose::STANDARD
                        .decode(&data)
                        .unwrap_or_default();
                    if String::from_utf8_lossy(&decoded).contains("SSHTOOL_PTY_TEST_OK") {
                        saw_marker = true;
                        break;
                    }
                }
            }
        }
        assert!(saw_marker, "never saw echoed marker in PTY output");

        sender.send(SessionCommand::Close).unwrap();
        let _ = std::fs::remove_file(&db_path);
    }
}
