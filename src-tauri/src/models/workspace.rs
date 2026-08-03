use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    pub id: Uuid,
    pub label: String,
    pub sort_order: i32,
    pub created_at: String,
    // Not a column - a COUNT(*) subquery in data::workspaces::list, purely
    // so the Workspaces panel can show "N hosts" per saved layout without
    // an extra round trip per row.
    pub tab_count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceTab {
    pub id: Uuid,
    pub workspace_id: Uuid,
    pub host_id: Uuid,
    pub kind: String,
    pub pane_count: i32,
    pub sort_order: i32,
}

// The tab list is captured once, at save time, from whatever's actually
// open - there's no "add a tab to an existing saved workspace" flow, so
// this only ever appears as a `Vec` argument to workspaces::create.
#[derive(Debug, Clone, Deserialize)]
pub struct WorkspaceTabInput {
    pub host_id: Uuid,
    pub kind: String,
    pub pane_count: i32,
    pub sort_order: i32,
}
