use tauri::State;
use uuid::Uuid;

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
