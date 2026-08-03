use tauri::State;
use uuid::Uuid;

use crate::data::workspaces;
use crate::error::AppResult;
use crate::models::workspace::{Workspace, WorkspaceTab, WorkspaceTabInput};
use crate::state::AppState;

#[tauri::command]
pub fn workspace_list(state: State<AppState>) -> AppResult<Vec<Workspace>> {
    let conn = state.db.lock().unwrap();
    workspaces::list(&conn)
}

#[tauri::command]
pub fn workspace_list_tabs(state: State<AppState>, workspace_id: Uuid) -> AppResult<Vec<WorkspaceTab>> {
    let conn = state.db.lock().unwrap();
    workspaces::list_tabs(&conn, workspace_id)
}

#[tauri::command]
pub fn workspace_create(
    state: State<AppState>,
    label: String,
    tabs: Vec<WorkspaceTabInput>,
) -> AppResult<Workspace> {
    let conn = state.db.lock().unwrap();
    workspaces::create(&conn, &label, &tabs)
}

#[tauri::command]
pub fn workspace_rename(state: State<AppState>, id: Uuid, label: String) -> AppResult<Workspace> {
    let conn = state.db.lock().unwrap();
    workspaces::rename(&conn, id, &label)
}

#[tauri::command]
pub fn workspace_delete(state: State<AppState>, id: Uuid) -> AppResult<()> {
    let conn = state.db.lock().unwrap();
    workspaces::delete(&conn, id)
}
