use tauri::State;
use uuid::Uuid;

use crate::data::snippets;
use crate::error::AppResult;
use crate::models::snippet::{Snippet, SnippetInput};
use crate::ssh::exec::{self, HostExecResult};
use crate::state::AppState;

#[tauri::command]
pub fn snippet_list(state: State<AppState>) -> AppResult<Vec<Snippet>> {
    let conn = state.db.lock().unwrap();
    snippets::list(&conn)
}

#[tauri::command]
pub fn snippet_create(state: State<AppState>, input: SnippetInput) -> AppResult<Snippet> {
    let conn = state.db.lock().unwrap();
    snippets::create(&conn, input)
}

#[tauri::command]
pub fn snippet_update(state: State<AppState>, id: Uuid, input: SnippetInput) -> AppResult<Snippet> {
    let conn = state.db.lock().unwrap();
    snippets::update(&conn, id, input)
}

#[tauri::command]
pub fn snippet_delete(state: State<AppState>, id: Uuid) -> AppResult<()> {
    let conn = state.db.lock().unwrap();
    snippets::delete(&conn, id)
}

#[tauri::command]
pub async fn snippet_run_on_hosts(
    state: State<'_, AppState>,
    host_ids: Vec<Uuid>,
    command: String,
) -> Result<Vec<HostExecResult>, ()> {
    Ok(exec::run_on_hosts(&state, host_ids, command).await)
}
