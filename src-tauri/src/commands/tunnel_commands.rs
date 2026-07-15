use tauri::State;
use uuid::Uuid;

use crate::error::AppResult;
use crate::ssh::tunnel::{self, TunnelInfo, TunnelInput};
use crate::state::AppState;

#[tauri::command]
pub async fn tunnel_start(state: State<'_, AppState>, input: TunnelInput) -> AppResult<Uuid> {
    let tunnels = state.tunnels.clone();
    tunnel::start(&state, tunnels, input).await
}

#[tauri::command]
pub fn tunnel_stop(state: State<AppState>, tunnel_id: Uuid) {
    tunnel::stop(&state.tunnels, tunnel_id);
}

#[tauri::command]
pub fn tunnel_list(state: State<AppState>) -> Vec<TunnelInfo> {
    tunnel::list(&state.tunnels)
}
