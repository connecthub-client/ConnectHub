use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Host {
    pub id: Uuid,
    pub group_id: Option<Uuid>,
    pub label: String,
    pub hostname: String,
    pub port: u16,
    pub identity_id: Option<Uuid>,
    pub jump_host_id: Option<Uuid>,
    pub vpn_profile_id: Option<Uuid>,
    pub color: Option<String>,
    pub notes: Option<String>,
    pub sort_order: i32,
    pub last_connected_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct HostInput {
    pub group_id: Option<Uuid>,
    pub label: String,
    pub hostname: String,
    pub port: u16,
    pub identity_id: Option<Uuid>,
    pub jump_host_id: Option<Uuid>,
    pub vpn_profile_id: Option<Uuid>,
    pub color: Option<String>,
    pub notes: Option<String>,
    pub sort_order: i32,
}
