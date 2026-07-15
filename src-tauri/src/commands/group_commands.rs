use tauri::State;
use uuid::Uuid;

use crate::data::groups;
use crate::error::AppResult;
use crate::models::group::{Group, GroupInput};
use crate::state::AppState;

#[tauri::command]
pub fn group_list(state: State<AppState>) -> AppResult<Vec<Group>> {
    let conn = state.db.lock().unwrap();
    groups::list(&conn)
}

#[tauri::command]
pub fn group_create(state: State<AppState>, input: GroupInput) -> AppResult<Group> {
    let conn = state.db.lock().unwrap();
    groups::create(&conn, input)
}

#[tauri::command]
pub fn group_update(state: State<AppState>, id: Uuid, input: GroupInput) -> AppResult<Group> {
    let conn = state.db.lock().unwrap();
    groups::update(&conn, id, input)
}

#[tauri::command]
pub fn group_delete(state: State<AppState>, id: Uuid) -> AppResult<()> {
    let conn = state.db.lock().unwrap();
    groups::delete(&conn, id)
}
