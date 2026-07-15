use tauri::State;
use uuid::Uuid;

use crate::error::AppResult;
use crate::ssh::sftp::{self, SftpEntry};
use crate::state::AppState;

#[tauri::command]
pub async fn sftp_connect(state: State<'_, AppState>, host_id: Uuid) -> AppResult<Uuid> {
    let sftp_sessions = state.sftp_sessions.clone();
    sftp::connect(&state, sftp_sessions, host_id).await
}

#[tauri::command]
pub async fn sftp_canonicalize(
    state: State<'_, AppState>,
    sftp_id: Uuid,
    path: String,
) -> AppResult<String> {
    sftp::canonicalize(&state.sftp_sessions, sftp_id, path).await
}

#[tauri::command]
pub async fn sftp_list(
    state: State<'_, AppState>,
    sftp_id: Uuid,
    path: String,
) -> AppResult<Vec<SftpEntry>> {
    sftp::list(&state.sftp_sessions, sftp_id, path).await
}

#[tauri::command]
pub async fn sftp_mkdir(state: State<'_, AppState>, sftp_id: Uuid, path: String) -> AppResult<()> {
    sftp::mkdir(&state.sftp_sessions, sftp_id, path).await
}

#[tauri::command]
pub async fn sftp_rename(
    state: State<'_, AppState>,
    sftp_id: Uuid,
    from: String,
    to: String,
) -> AppResult<()> {
    sftp::rename(&state.sftp_sessions, sftp_id, from, to).await
}

#[tauri::command]
pub async fn sftp_remove_file(
    state: State<'_, AppState>,
    sftp_id: Uuid,
    path: String,
) -> AppResult<()> {
    sftp::remove_file(&state.sftp_sessions, sftp_id, path).await
}

#[tauri::command]
pub async fn sftp_remove_dir(
    state: State<'_, AppState>,
    sftp_id: Uuid,
    path: String,
) -> AppResult<()> {
    sftp::remove_dir(&state.sftp_sessions, sftp_id, path).await
}

#[tauri::command]
pub async fn sftp_download(
    state: State<'_, AppState>,
    sftp_id: Uuid,
    remote_path: String,
    local_path: String,
) -> AppResult<()> {
    sftp::download(&state.sftp_sessions, sftp_id, remote_path, local_path).await
}

#[tauri::command]
pub async fn sftp_upload(
    state: State<'_, AppState>,
    sftp_id: Uuid,
    local_path: String,
    remote_path: String,
) -> AppResult<()> {
    sftp::upload(&state.sftp_sessions, sftp_id, local_path, remote_path).await
}

#[tauri::command]
pub fn sftp_disconnect(state: State<AppState>, sftp_id: Uuid) {
    sftp::disconnect(&state.sftp_sessions, sftp_id);
}
