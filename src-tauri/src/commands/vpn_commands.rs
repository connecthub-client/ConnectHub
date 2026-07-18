use tauri::State;
use uuid::Uuid;

use crate::data::vpn_profiles;
use crate::error::AppResult;
use crate::models::vpn_profile::{VpnProfile, VpnProfileInput};
use crate::state::AppState;
use crate::vpn::{self, VpnConnectionStatus, VpnStatus};

#[tauri::command]
pub fn vpn_profile_list(state: State<AppState>) -> AppResult<Vec<VpnProfile>> {
    let conn = state.db.lock().unwrap();
    vpn_profiles::list(&conn)
}

#[tauri::command]
pub fn vpn_profile_create(state: State<AppState>, input: VpnProfileInput) -> AppResult<VpnProfile> {
    let conn = state.db.lock().unwrap();
    state.with_key(|key| vpn_profiles::create(&conn, key, input))
}

#[tauri::command]
pub fn vpn_profile_update(
    state: State<AppState>,
    id: Uuid,
    input: VpnProfileInput,
) -> AppResult<VpnProfile> {
    let conn = state.db.lock().unwrap();
    state.with_key(|key| vpn_profiles::update(&conn, key, id, input))
}

#[tauri::command]
pub fn vpn_profile_delete(state: State<AppState>, id: Uuid) -> AppResult<()> {
    let conn = state.db.lock().unwrap();
    vpn_profiles::delete(&conn, id)
}

#[tauri::command]
pub fn vpn_setup_status() -> bool {
    vpn::setup::is_installed()
}

#[tauri::command]
pub async fn vpn_setup_install() -> AppResult<()> {
    vpn::setup::install().await
}

#[tauri::command]
pub async fn vpn_connect(state: State<'_, AppState>, profile_id: Uuid) -> AppResult<VpnStatus> {
    let vpn_connections = state.vpn_connections.clone();
    vpn::connect(&state, vpn_connections, profile_id).await
}

#[tauri::command]
pub fn vpn_disconnect(state: State<AppState>, profile_id: Uuid) -> AppResult<()> {
    vpn::disconnect(&state.vpn_connections, profile_id)
}

#[tauri::command]
pub fn vpn_status(state: State<AppState>, profile_id: Uuid) -> VpnStatus {
    vpn::status(&state.vpn_connections, profile_id)
}

#[tauri::command]
pub fn vpn_active_statuses(state: State<AppState>) -> Vec<VpnConnectionStatus> {
    vpn::list_active(&state.vpn_connections)
}

#[tauri::command]
pub fn vpn_disconnect_all(state: State<AppState>) {
    vpn::disconnect_all(&state.vpn_connections)
}
