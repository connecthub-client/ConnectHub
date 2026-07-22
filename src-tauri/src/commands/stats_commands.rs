use tauri::State;
use uuid::Uuid;

use crate::error::AppResult;
use crate::ssh::stats::{self, HostStats};
use crate::state::AppState;

#[tauri::command]
pub async fn host_stats(state: State<'_, AppState>, host_id: Uuid) -> AppResult<HostStats> {
    stats::fetch(&state, host_id).await
}
