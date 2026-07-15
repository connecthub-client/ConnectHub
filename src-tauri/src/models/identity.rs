use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AuthMethod {
    Password,
    PrivateKey,
    Agent,
}

impl AuthMethod {
    pub fn as_str(&self) -> &'static str {
        match self {
            AuthMethod::Password => "password",
            AuthMethod::PrivateKey => "private_key",
            AuthMethod::Agent => "agent",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "password" => Some(AuthMethod::Password),
            "private_key" => Some(AuthMethod::PrivateKey),
            "agent" => Some(AuthMethod::Agent),
            _ => None,
        }
    }
}

// `has_password` reports whether a password is stored without ever exposing
// it back to the frontend, similar to how password managers mask saved values.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Identity {
    pub id: Uuid,
    pub label: String,
    pub username: String,
    pub auth_method: AuthMethod,
    pub ssh_key_id: Option<Uuid>,
    pub has_password: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct IdentityInput {
    pub label: String,
    pub username: String,
    pub auth_method: AuthMethod,
    pub ssh_key_id: Option<Uuid>,
    // None = leave existing password (on update) / no password (on create).
    // Some("") is treated the same as None to allow clearing via empty input.
    pub password: Option<String>,
}
