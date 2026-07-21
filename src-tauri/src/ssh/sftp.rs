use std::sync::Arc;

use dashmap::DashMap;
use russh_sftp::client::SftpSession;
use serde::Serialize;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

use super::session::connect_and_authenticate;

pub type SftpMap = Arc<DashMap<Uuid, Arc<SftpSession>>>;

#[derive(Debug, Serialize, Clone)]
pub struct SftpEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    // Unix seconds; omitted if the server didn't report a modification time.
    pub modified: Option<i64>,
}

pub async fn connect(app: &AppState, sftp_sessions: SftpMap, host_id: Uuid) -> AppResult<Uuid> {
    let handle = connect_and_authenticate(app, host_id, None).await?;

    let channel = handle
        .channel_open_session()
        .await
        .map_err(|e| AppError::Ssh(e.to_string()))?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|e| AppError::Ssh(e.to_string()))?;

    let sftp = SftpSession::new(channel.into_stream())
        .await
        .map_err(|e| AppError::Ssh(format!("sftp init failed: {e}")))?;

    // The SSH `Handle` itself isn't stored anywhere - `SftpSession` owns the
    // channel/stream it was built from, which is what actually keeps the
    // underlying connection alive for as long as this session is in the map.
    let sftp_id = Uuid::new_v4();
    sftp_sessions.insert(sftp_id, Arc::new(sftp));
    Ok(sftp_id)
}

pub async fn canonicalize(sftp_sessions: &SftpMap, sftp_id: Uuid, path: String) -> AppResult<String> {
    let sftp = get_session(sftp_sessions, sftp_id)?;
    sftp.canonicalize(&path)
        .await
        .map_err(|e| AppError::Ssh(e.to_string()))
}

fn get_session(sftp_sessions: &SftpMap, sftp_id: Uuid) -> AppResult<Arc<SftpSession>> {
    sftp_sessions
        .get(&sftp_id)
        .map(|entry| entry.clone())
        .ok_or(AppError::SessionNotFound)
}

pub async fn list(sftp_sessions: &SftpMap, sftp_id: Uuid, path: String) -> AppResult<Vec<SftpEntry>> {
    let sftp = get_session(sftp_sessions, sftp_id)?;
    let read_dir = sftp
        .read_dir(&path)
        .await
        .map_err(|e| AppError::Ssh(e.to_string()))?;

    let mut entries: Vec<SftpEntry> = read_dir
        .map(|entry| SftpEntry {
            name: entry.file_name(),
            path: entry.path(),
            is_dir: entry.file_type().is_dir(),
            is_symlink: entry.file_type().is_symlink(),
            size: entry.metadata().len(),
            modified: entry
                .metadata()
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64),
        })
        .collect();

    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(entries)
}

pub async fn mkdir(sftp_sessions: &SftpMap, sftp_id: Uuid, path: String) -> AppResult<()> {
    let sftp = get_session(sftp_sessions, sftp_id)?;
    sftp.create_dir(&path)
        .await
        .map_err(|e| AppError::Ssh(e.to_string()))
}

pub async fn rename(
    sftp_sessions: &SftpMap,
    sftp_id: Uuid,
    from: String,
    to: String,
) -> AppResult<()> {
    let sftp = get_session(sftp_sessions, sftp_id)?;
    sftp.rename(&from, &to)
        .await
        .map_err(|e| AppError::Ssh(e.to_string()))
}

pub async fn remove_file(sftp_sessions: &SftpMap, sftp_id: Uuid, path: String) -> AppResult<()> {
    let sftp = get_session(sftp_sessions, sftp_id)?;
    sftp.remove_file(&path)
        .await
        .map_err(|e| AppError::Ssh(e.to_string()))
}

pub async fn remove_dir(sftp_sessions: &SftpMap, sftp_id: Uuid, path: String) -> AppResult<()> {
    let sftp = get_session(sftp_sessions, sftp_id)?;
    sftp.remove_dir(&path)
        .await
        .map_err(|e| AppError::Ssh(e.to_string()))
}

pub async fn download(
    sftp_sessions: &SftpMap,
    sftp_id: Uuid,
    remote_path: String,
    local_path: String,
) -> AppResult<()> {
    let sftp = get_session(sftp_sessions, sftp_id)?;
    let data = sftp
        .read(&remote_path)
        .await
        .map_err(|e| AppError::Ssh(e.to_string()))?;
    tokio::fs::write(&local_path, data).await?;
    Ok(())
}

pub async fn upload(
    sftp_sessions: &SftpMap,
    sftp_id: Uuid,
    local_path: String,
    remote_path: String,
) -> AppResult<()> {
    use tokio::io::AsyncWriteExt;

    let sftp = get_session(sftp_sessions, sftp_id)?;
    let data = tokio::fs::read(&local_path).await?;
    // `SftpSession::write` requires the remote file to already exist; `create`
    // makes (or truncates) it first, matching what "upload" should mean here.
    let mut file = sftp
        .create(&remote_path)
        .await
        .map_err(|e| AppError::Ssh(e.to_string()))?;
    file.write_all(&data)
        .await
        .map_err(|e| AppError::Ssh(e.to_string()))
}

pub fn disconnect(sftp_sessions: &SftpMap, sftp_id: Uuid) {
    sftp_sessions.remove(&sftp_id);
}

#[cfg(test)]
mod tests {
    // Hermetic equivalent of live_sshd_tests::full_sftp_roundtrip_over_real_sshd
    // below, against the in-process TestServer's real-tempdir-backed SFTP
    // handler instead of a real system sshd - runs in every normal
    // `cargo test`.
    use super::*;
    use crate::data::{hosts, identities, ssh_keys};
    use crate::models::host::HostInput;
    use crate::models::identity::{AuthMethod, IdentityInput};
    use crate::models::ssh_key::ImportKeyInput;
    use crate::ssh::test_support::TestServer;
    use crate::state::AppState;
    use crate::vault::kdf::test_key;

    fn tempfile_dir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join("connecthub-test-sftp-client");
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[tokio::test]
    async fn full_sftp_roundtrip() {
        let test_server = TestServer::start().await;

        let db_path = std::env::temp_dir().join(format!("connecthub-test-sftp-{}.db", Uuid::new_v4()));
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        crate::data::init_schema(&conn).unwrap();
        crate::ssh::known_hosts::init_schema(&conn).unwrap();

        let vault_key = test_key();

        let ssh_key = ssh_keys::import(
            &conn,
            &vault_key,
            ImportKeyInput {
                label: "hermetic sftp test key".into(),
                private_key_pem: test_server.client_key_pem.clone(),
                passphrase: None,
            },
        )
        .unwrap();

        let identity = identities::create(
            &conn,
            &vault_key,
            IdentityInput {
                label: "hermetic sftp test identity".into(),
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

        let sftp_sessions = app_state.sftp_sessions.clone();
        let sftp_id = connect(&app_state, sftp_sessions.clone(), host.id)
            .await
            .expect("sftp connect failed");

        // Paths are relative to TestServer's own temp root (which stands
        // in for "/"), not a real absolute path on this machine.
        let work_dir = "/work".to_string();
        mkdir(&sftp_sessions, sftp_id, work_dir.clone()).await.expect("mkdir failed");

        let local_src = tempfile_dir().join(format!("upload-src-{}.txt", Uuid::new_v4()));
        std::fs::write(&local_src, b"hello from connecthub sftp test").unwrap();

        let remote_file = format!("{work_dir}/uploaded.txt");
        upload(&sftp_sessions, sftp_id, local_src.to_string_lossy().to_string(), remote_file.clone())
            .await
            .expect("upload failed");

        let entries = list(&sftp_sessions, sftp_id, work_dir.clone()).await.expect("list failed");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "uploaded.txt");
        assert_eq!(entries[0].size, 31);
        assert!(!entries[0].is_dir);

        let local_dst = tempfile_dir().join(format!("download-dst-{}.txt", Uuid::new_v4()));
        download(&sftp_sessions, sftp_id, remote_file.clone(), local_dst.to_string_lossy().to_string())
            .await
            .expect("download failed");
        let downloaded = std::fs::read_to_string(&local_dst).unwrap();
        assert_eq!(downloaded, "hello from connecthub sftp test");

        let renamed_file = format!("{work_dir}/renamed.txt");
        rename(&sftp_sessions, sftp_id, remote_file, renamed_file.clone())
            .await
            .expect("rename failed");
        let entries = list(&sftp_sessions, sftp_id, work_dir.clone())
            .await
            .expect("list after rename failed");
        assert_eq!(entries[0].name, "renamed.txt");

        remove_file(&sftp_sessions, sftp_id, renamed_file).await.expect("remove_file failed");
        let entries = list(&sftp_sessions, sftp_id, work_dir.clone())
            .await
            .expect("list after delete failed");
        assert!(entries.is_empty());

        remove_dir(&sftp_sessions, sftp_id, work_dir).await.expect("remove_dir failed");

        disconnect(&sftp_sessions, sftp_id);
        assert!(sftp_sessions.get(&sftp_id).is_none());

        let _ = std::fs::remove_file(&local_src);
        let _ = std::fs::remove_file(&local_dst);
        let _ = std::fs::remove_file(&db_path);
    }
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
    use crate::state::AppState;
    use crate::vault::kdf::test_key;

    fn tempfile_dir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join("sshtool-live-test");
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[tokio::test]
    #[ignore]
    async fn full_sftp_roundtrip_over_real_sshd() {
        let test_key_path =
            "/tmp/claude-1000/-home-mashhoud-NGI--workSpace-SSH-tool/cb0c64d1-0315-48de-86ae-3782252496ca/scratchpad/testkey/id_ed25519";
        let pem = std::fs::read_to_string(test_key_path).expect("test key not found");
        let username = std::env::var("USER").expect("USER env var not set");

        let db_dir = tempfile_dir();
        let db_path = db_dir.join(format!("sftp_flow_{}.db", Uuid::new_v4()));
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        crate::data::init_schema(&conn).unwrap();
        crate::ssh::known_hosts::init_schema(&conn).unwrap();

        let vault_key = test_key();

        let ssh_key = ssh_keys::import(
            &conn,
            &vault_key,
            ImportKeyInput {
                label: "sftp live test key".into(),
                private_key_pem: pem,
                passphrase: None,
            },
        )
        .unwrap();

        let identity = identities::create(
            &conn,
            &vault_key,
            IdentityInput {
                label: "sftp live test identity".into(),
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

        let sftp_sessions = app_state.sftp_sessions.clone();
        let sftp_id = connect(&app_state, sftp_sessions.clone(), host.id)
            .await
            .expect("sftp connect failed");

        let work_dir = format!("/tmp/sshtool-sftp-test-{}", Uuid::new_v4());
        mkdir(&sftp_sessions, sftp_id, work_dir.clone())
            .await
            .expect("mkdir failed");

        let local_src = tempfile_dir().join("upload-src.txt");
        std::fs::write(&local_src, b"hello from sshtool sftp test").unwrap();

        let remote_file = format!("{work_dir}/uploaded.txt");
        upload(
            &sftp_sessions,
            sftp_id,
            local_src.to_string_lossy().to_string(),
            remote_file.clone(),
        )
        .await
        .expect("upload failed");

        let entries = list(&sftp_sessions, sftp_id, work_dir.clone())
            .await
            .expect("list failed");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "uploaded.txt");
        assert_eq!(entries[0].size, 28);
        assert!(!entries[0].is_dir);

        let local_dst = tempfile_dir().join("download-dst.txt");
        download(
            &sftp_sessions,
            sftp_id,
            remote_file.clone(),
            local_dst.to_string_lossy().to_string(),
        )
        .await
        .expect("download failed");
        let downloaded = std::fs::read_to_string(&local_dst).unwrap();
        assert_eq!(downloaded, "hello from sshtool sftp test");

        let renamed_file = format!("{work_dir}/renamed.txt");
        rename(&sftp_sessions, sftp_id, remote_file, renamed_file.clone())
            .await
            .expect("rename failed");
        let entries = list(&sftp_sessions, sftp_id, work_dir.clone())
            .await
            .expect("list after rename failed");
        assert_eq!(entries[0].name, "renamed.txt");

        remove_file(&sftp_sessions, sftp_id, renamed_file)
            .await
            .expect("remove_file failed");
        let entries = list(&sftp_sessions, sftp_id, work_dir.clone())
            .await
            .expect("list after delete failed");
        assert!(entries.is_empty());

        remove_dir(&sftp_sessions, sftp_id, work_dir)
            .await
            .expect("remove_dir failed");

        disconnect(&sftp_sessions, sftp_id);
        assert!(sftp_sessions.get(&sftp_id).is_none());

        let _ = std::fs::remove_file(&local_src);
        let _ = std::fs::remove_file(&local_dst);
        let _ = std::fs::remove_file(&db_path);
    }
}
