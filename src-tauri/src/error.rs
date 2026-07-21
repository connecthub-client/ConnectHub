use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("a vault already exists")]
    VaultAlreadyInitialized,
    #[error("no vault has been created yet")]
    VaultNotInitialized,
    #[error("incorrect master password")]
    InvalidPassword,
    #[error("vault is locked")]
    VaultLocked,
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("crypto error: {0}")]
    Crypto(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("not found")]
    NotFound,
    #[error("invalid ssh key: {0}")]
    InvalidKey(String),
    #[error(
        "host key for {hostname} has changed (expected {expected}, got {got}) - \
         refusing to connect. This could mean someone is intercepting the connection, \
         or the server was legitimately reinstalled."
    )]
    HostKeyMismatch {
        hostname: String,
        expected: String,
        got: String,
    },
    #[error("SSH error: {0}")]
    Ssh(String),
    // More specific SSH connect-phase failures, classified from the
    // underlying io::Error/russh::Error at the one place (connect_and_authenticate)
    // that has enough context to do so - see ssh::session::classify_connect_error.
    // Kept distinct from the Ssh(String) catch-all above so a caller (or a
    // future frontend translation layer) can tell "the network refused the
    // connection" apart from "we connected fine but auth was rejected"
    // without string-matching an arbitrary message.
    #[error("connection refused by {0}")]
    ConnectionRefused(String),
    #[error("connection to {0} timed out")]
    ConnectionTimedOut(String),
    #[error("could not resolve hostname {0}")]
    DnsResolutionFailed(String),
    #[error("authentication failed: {0}")]
    AuthenticationFailed(String),
    #[error("session not found")]
    SessionNotFound,
    #[error("CSV error: {0}")]
    Csv(String),
    #[error("Google account error: {0}")]
    Google(String),
    #[error("VPN error: {0}")]
    Vpn(String),
}

// Tauri serializes command errors to the frontend as JSON; a plain string
// message is all the UI needs to display.
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
