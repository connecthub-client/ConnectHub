use tauri::State;

use crate::error::AppResult;
use crate::google::{self, GoogleAuthStatus};
use crate::state::AppState;

#[tauri::command]
pub fn google_status(state: State<AppState>) -> AppResult<GoogleAuthStatus> {
    google::status(&state)
}

#[tauri::command]
pub async fn google_login(state: State<'_, AppState>) -> AppResult<GoogleAuthStatus> {
    google::login(&state).await
}

#[tauri::command]
pub fn google_logout(state: State<AppState>) -> AppResult<()> {
    google::logout(&state)
}

#[tauri::command]
pub async fn google_backup_now(state: State<'_, AppState>) -> AppResult<()> {
    google::backup_now(&state).await
}

#[tauri::command]
pub async fn google_restore(state: State<'_, AppState>) -> AppResult<()> {
    google::restore_from_drive(&state).await
}
