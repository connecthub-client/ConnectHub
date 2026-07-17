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
    #[error("session not found")]
    SessionNotFound,
    #[error("CSV error: {0}")]
    Csv(String),
    #[error("Google account error: {0}")]
    Google(String),
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
