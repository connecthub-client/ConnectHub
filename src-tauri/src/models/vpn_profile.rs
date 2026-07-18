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
    // If true, a `pull-filter ignore "redirect-gateway"` directive is added
    // at connect time so this VPN can't take over the default route - see
    // vpn::connect. Lets multiple profiles (each reaching only its own
    // private subnet) stay connected at once without fighting over which
    // one owns "the internet".
    pub avoid_default_route: bool,
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
    pub avoid_default_route: bool,
}
