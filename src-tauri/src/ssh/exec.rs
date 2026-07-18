use russh::ChannelMsg;
use serde::Serialize;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

use super::session::connect_and_authenticate;

#[derive(Debug, Clone, Serialize)]
pub struct ExecOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_status: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct HostExecResult {
    pub host_id: Uuid,
    pub output: Option<ExecOutput>,
    pub error: Option<String>,
}

// Runs `command` on a single host over its own dedicated connection (no PTY -
// just a one-shot exec channel), collecting stdout/stderr/exit status.
pub async fn run(app: &AppState, host_id: Uuid, command: String) -> AppResult<ExecOutput> {
    let handle = connect_and_authenticate(app, host_id, None).await?;
    let mut channel = handle
        .channel_open_session()
        .await
        .map_err(|e| AppError::Ssh(e.to_string()))?;
    channel
        .exec(true, command)
        .await
        .map_err(|e| AppError::Ssh(e.to_string()))?;

    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let mut exit_status = None;

    loop {
        match channel.wait().await {
            Some(ChannelMsg::Data { data }) => stdout.extend_from_slice(&data),
            Some(ChannelMsg::ExtendedData { data, ext: 1 }) => stderr.extend_from_slice(&data),
            Some(ChannelMsg::ExitStatus { exit_status: code }) => exit_status = Some(code),
            // `Eof` only promises no more *data*; some servers send it before
            // `ExitStatus`, so only `Close` (or the channel dropping) means
            // we're truly done.
            Some(ChannelMsg::Close) | None => break,
            _ => {}
        }
    }

    Ok(ExecOutput {
        stdout: String::from_utf8_lossy(&stdout).to_string(),
        stderr: String::from_utf8_lossy(&stderr).to_string(),
        exit_status,
    })
}

// Runs `command` on every host concurrently, each over its own connection.
// Per-host failures (auth, connect, etc.) are captured individually rather
// than aborting the whole batch.
pub async fn run_on_hosts(app: &AppState, host_ids: Vec<Uuid>, command: String) -> Vec<HostExecResult> {
    let tasks = host_ids.into_iter().map(|host_id| {
        let command = command.clone();
        async move {
            match run(app, host_id, command).await {
                Ok(output) => HostExecResult {
                    host_id,
                    output: Some(output),
                    error: None,
                },
                Err(e) => HostExecResult {
                    host_id,
                    output: None,
                    error: Some(e.to_string()),
                },
            }
        }
    });

    futures::future::join_all(tasks).await
}

#[cfg(test)]
mod live_sshd_tests {
    // Manual, environment-dependent check against the real local sshd - see
    // ssh::session::live_sshd_tests for the rationale (run with --ignored).
    use super::*;
    use crate::data::{hosts, identities, ssh_keys};
    use crate::models::host::HostInput;
    use crate::models::identity::{AuthMethod, IdentityInput};
    use crate::models::ssh_key::ImportKeyInput;
    use dashmap::DashMap;
    use std::sync::Arc;

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
        let db_path = db_dir.join(format!("exec_flow_{}.db", Uuid::new_v4()));
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        crate::data::init_schema(&conn).unwrap();
        crate::ssh::known_hosts::init_schema(&conn).unwrap();

        let vault_key = crate::vault::kdf::test_key();

        let ssh_key = ssh_keys::import(
            &conn,
            &vault_key,
            ImportKeyInput {
                label: "exec live test key".into(),
                private_key_pem: pem,
                passphrase: None,
            },
        )
        .unwrap();

        let identity = identities::create(
            &conn,
            &vault_key,
            IdentityInput {
                label: "exec live test identity".into(),
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
                vpn_profile_id: None,
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
            vpn_connections: Arc::new(DashMap::new()),
            google_login_cancel: std::sync::Mutex::new(None),
        }
    }

    fn host_id_of(app: &AppState) -> Uuid {
        let conn = app.db.lock().unwrap();
        hosts::list(&conn).unwrap()[0].id
    }

    #[tokio::test]
    #[ignore]
    async fn run_captures_stdout_and_exit_status() {
        let app = build_app_state().await;
        let host_id = host_id_of(&app);

        let output = run(&app, host_id, "echo hello_from_exec; exit 0".into())
            .await
            .expect("exec failed");

        assert_eq!(output.stdout.trim(), "hello_from_exec");
        assert_eq!(output.exit_status, Some(0));
    }

    #[tokio::test]
    #[ignore]
    async fn run_captures_nonzero_exit_status_and_stderr() {
        let app = build_app_state().await;
        let host_id = host_id_of(&app);

        let output = run(&app, host_id, "echo oops >&2; exit 7".into())
            .await
            .expect("exec failed");

        assert_eq!(output.stderr.trim(), "oops");
        assert_eq!(output.exit_status, Some(7));
    }

    #[tokio::test]
    #[ignore]
    async fn run_on_hosts_isolates_per_host_failures() {
        let app = build_app_state().await;
        let host_id = host_id_of(&app);
        let bogus_host_id = Uuid::new_v4(); // not in the db at all

        let results = run_on_hosts(
            &app,
            vec![host_id, bogus_host_id],
            "echo batch_test_ok".into(),
        )
        .await;

        assert_eq!(results.len(), 2);
        let ok_result = results.iter().find(|r| r.host_id == host_id).unwrap();
        assert!(ok_result.error.is_none());
        assert_eq!(ok_result.output.as_ref().unwrap().stdout.trim(), "batch_test_ok");

        let bad_result = results.iter().find(|r| r.host_id == bogus_host_id).unwrap();
        assert!(bad_result.output.is_none());
        assert!(bad_result.error.is_some());
    }
}
