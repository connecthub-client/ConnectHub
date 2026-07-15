use tauri::State;
use uuid::Uuid;

use crate::data::identities;
use crate::error::AppResult;
use crate::models::identity::{Identity, IdentityInput};
use crate::state::AppState;

#[tauri::command]
pub fn identity_list(state: State<AppState>) -> AppResult<Vec<Identity>> {
    let conn = state.db.lock().unwrap();
    identities::list(&conn)
}

#[tauri::command]
pub fn identity_create(state: State<AppState>, input: IdentityInput) -> AppResult<Identity> {
    let conn = state.db.lock().unwrap();
    state.with_key(|key| identities::create(&conn, key, input))
}

#[tauri::command]
pub fn identity_update(
    state: State<AppState>,
    id: Uuid,
    input: IdentityInput,
) -> AppResult<Identity> {
    let conn = state.db.lock().unwrap();
    state.with_key(|key| identities::update(&conn, key, id, input))
}

#[tauri::command]
pub fn identity_delete(state: State<AppState>, id: Uuid) -> AppResult<()> {
    let conn = state.db.lock().unwrap();
    identities::delete(&conn, id)
}
