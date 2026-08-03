use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::models::tag::Tag;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Host {
    pub id: Uuid,
    pub group_id: Option<Uuid>,
    pub label: String,
    pub hostname: String,
    pub port: u16,
    pub identity_id: Option<Uuid>,
    pub vpn_profile_id: Option<Uuid>,
    pub color: Option<String>,
    // Preset icon key (e.g. "server", "cloud", "database") chosen from a
    // fixed set the frontend renders as inline SVGs - not a file path or
    // arbitrary image, so there's no upload/storage surface here.
    pub icon: Option<String>,
    pub notes: Option<String>,
    pub sort_order: i32,
    pub last_connected_at: Option<String>,
    pub is_favorite: bool,
    // Populated by a second query in data::hosts::get/list (joined from the
    // host_tags table) - not a column on the hosts row itself.
    pub tags: Vec<Tag>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct HostInput {
    pub group_id: Option<Uuid>,
    pub label: String,
    pub hostname: String,
    pub port: u16,
    pub identity_id: Option<Uuid>,
    pub vpn_profile_id: Option<Uuid>,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub notes: Option<String>,
    pub sort_order: i32,
    // Tag ids to associate with this host - resolved to existing tags via
    // tag_create (get-or-create semantics) on the frontend before submit,
    // so this is always ids, never raw labels, matching identity_id/
    // vpn_profile_id's existing convention.
    #[serde(default)]
    pub tag_ids: Vec<Uuid>,
}
