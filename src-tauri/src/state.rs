use dashmap::DashMap;
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use crate::error::{AppError, AppResult};
use crate::ssh::session::SessionCommand;
use crate::ssh::sftp::SftpMap;
use crate::ssh::tunnel::TunnelMap;
use crate::vault::VaultKey;
use crate::vpn::VpnMap;

pub struct AppState {
    pub db: Mutex<Connection>,
    pub db_path: PathBuf,
    pub vault_key: Mutex<Option<VaultKey>>,
    pub sessions: Arc<DashMap<uuid::Uuid, tokio::sync::mpsc::UnboundedSender<SessionCommand>>>,
    pub sftp_sessions: SftpMap,
    pub tunnels: TunnelMap,
    pub vpn_connections: VpnMap,
    // Set while a Google sign-in is waiting on the browser; letting the
    // frontend fire this early is the only way to get unstuck if the user
    // closes the browser tab without finishing, since nothing else signals
    // that from the loopback server's side. See google::cancel_login.
    pub google_login_cancel: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
}

impl AppState {
    pub fn new() -> AppResult<Self> {
        let db_path = crate::vault::store::db_path()?;
        let db = crate::vault::store::open()?;
        crate::data::init_schema(&db)?;
        crate::ssh::known_hosts::init_schema(&db)?;
        crate::vpn::cleanup_stale_profile_files();
        Ok(Self {
            db: Mutex::new(db),
            db_path,
            vault_key: Mutex::new(None),
            sessions: Arc::new(DashMap::new()),
            sftp_sessions: Arc::new(DashMap::new()),
            tunnels: Arc::new(DashMap::new()),
            vpn_connections: Arc::new(DashMap::new()),
            google_login_cancel: Mutex::new(None),
        })
    }

    // Runs `f` with the unlocked vault key, or returns AppError::VaultLocked.
    // Callers needing both the key and the db connection must lock `db`
    // first, then call this, to keep a consistent lock order.
    pub fn with_key<T>(&self, f: impl FnOnce(&VaultKey) -> AppResult<T>) -> AppResult<T> {
        let guard = self.vault_key.lock().unwrap();
        let key = guard.as_ref().ok_or(AppError::VaultLocked)?;
        f(key)
    }
}
