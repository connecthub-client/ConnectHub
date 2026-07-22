use tauri::State;
use uuid::Uuid;

use crate::data::host_csv::{self, ImportSummary};
use crate::data::hosts;
use crate::error::AppResult;
use crate::models::host::{Host, HostInput};
use crate::state::AppState;

#[tauri::command]
pub fn host_list(state: State<AppState>) -> AppResult<Vec<Host>> {
    let conn = state.db.lock().unwrap();
    hosts::list(&conn)
}

#[tauri::command]
pub fn host_create(state: State<AppState>, input: HostInput) -> AppResult<Host> {
    let conn = state.db.lock().unwrap();
    hosts::create(&conn, input)
}

#[tauri::command]
pub fn host_update(state: State<AppState>, id: Uuid, input: HostInput) -> AppResult<Host> {
    let conn = state.db.lock().unwrap();
    hosts::update(&conn, id, input)
}

#[tauri::command]
pub fn host_delete(state: State<AppState>, id: Uuid) -> AppResult<()> {
    let conn = state.db.lock().unwrap();
    hosts::delete(&conn, id)
}

#[tauri::command]
pub fn host_set_favorite(state: State<AppState>, id: Uuid, favorite: bool) -> AppResult<Host> {
    let conn = state.db.lock().unwrap();
    hosts::set_favorite(&conn, id, favorite)
}

#[tauri::command]
pub fn host_export_csv(state: State<AppState>) -> AppResult<String> {
    let conn = state.db.lock().unwrap();
    host_csv::export_csv(&conn)
}

#[tauri::command]
pub fn host_import_csv(state: State<AppState>, content: String) -> AppResult<ImportSummary> {
    let conn = state.db.lock().unwrap();
    host_csv::import_csv(&conn, &content)
}
