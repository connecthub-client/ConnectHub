use tauri::State;

use crate::error::AppResult;
use crate::ssh::known_hosts::{self, KnownHost};
use crate::state::AppState;

#[tauri::command]
pub fn known_hosts_list(state: State<AppState>) -> AppResult<Vec<KnownHost>> {
    let conn = state.db.lock().unwrap();
    known_hosts::list(&conn)
}

#[tauri::command]
pub fn known_hosts_delete(state: State<AppState>, hostname: String, port: u16) -> AppResult<()> {
    let conn = state.db.lock().unwrap();
    known_hosts::delete(&conn, &hostname, port)
}
