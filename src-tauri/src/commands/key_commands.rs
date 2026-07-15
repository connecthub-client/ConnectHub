use tauri::State;
use uuid::Uuid;

use crate::data::ssh_keys;
use crate::error::AppResult;
use crate::models::ssh_key::{GenerateKeyInput, ImportKeyInput, SshKey};
use crate::state::AppState;

#[tauri::command]
pub fn key_list(state: State<AppState>) -> AppResult<Vec<SshKey>> {
    let conn = state.db.lock().unwrap();
    ssh_keys::list(&conn)
}

#[tauri::command]
pub fn key_generate(state: State<AppState>, input: GenerateKeyInput) -> AppResult<SshKey> {
    let conn = state.db.lock().unwrap();
    state.with_key(|key| ssh_keys::generate(&conn, key, input))
}

#[tauri::command]
pub fn key_import(state: State<AppState>, input: ImportKeyInput) -> AppResult<SshKey> {
    let conn = state.db.lock().unwrap();
    state.with_key(|key| ssh_keys::import(&conn, key, input))
}

#[tauri::command]
pub fn key_delete(state: State<AppState>, id: Uuid) -> AppResult<()> {
    let conn = state.db.lock().unwrap();
    ssh_keys::delete(&conn, id)
}
