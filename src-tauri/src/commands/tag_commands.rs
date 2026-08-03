use tauri::State;
use uuid::Uuid;

use crate::data::tags;
use crate::error::AppResult;
use crate::models::tag::Tag;
use crate::state::AppState;

#[tauri::command]
pub fn tag_list(state: State<AppState>) -> AppResult<Vec<Tag>> {
    let conn = state.db.lock().unwrap();
    tags::list(&conn)
}

// Get-or-create by label: used both when a user picks an existing tag
// (which just returns it unchanged) and when they type a brand-new one.
#[tauri::command]
pub fn tag_create(state: State<AppState>, label: String) -> AppResult<Tag> {
    let conn = state.db.lock().unwrap();
    tags::get_or_create(&conn, &label)
}

#[tauri::command]
pub fn tag_delete(state: State<AppState>, id: Uuid) -> AppResult<()> {
    let conn = state.db.lock().unwrap();
    tags::delete(&conn, id)
}
