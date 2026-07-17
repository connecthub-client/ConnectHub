use serde::{Deserialize, Serialize};
use uuid::Uuid;

// `has_auth_password` reports whether a password is stored without ever
// exposing it back to the frontend, mirroring Identity::has_password.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VpnProfile {
    pub id: Uuid,
    pub label: String,
    pub config: String,
    pub auth_username: Option<String>,
    pub has_auth_password: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct VpnProfileInput {
    pub label: String,
    pub config: String,
    pub auth_username: Option<String>,
    // None = leave existing password (on update) / no password (on create).
    // Some("") is treated the same as None to allow clearing via empty input.
    pub auth_password: Option<String>,
}
