use serde::Serialize;
use tauri::State;

use crate::error::AppResult;
use crate::state::AppState;
use crate::vault::store;

#[derive(Serialize)]
pub struct VaultStatus {
    pub initialized: bool,
    pub unlocked: bool,
}

#[tauri::command]
pub fn vault_status(state: State<AppState>) -> AppResult<VaultStatus> {
    let conn = state.db.lock().unwrap();
    let initialized = store::is_initialized(&conn)?;
    let unlocked = state.vault_key.lock().unwrap().is_some();
    Ok(VaultStatus {
        initialized,
        unlocked,
    })
}

#[tauri::command]
pub fn vault_create(state: State<AppState>, password: String) -> AppResult<()> {
    let conn = state.db.lock().unwrap();
    let key = store::create(&conn, &password)?;
    *state.vault_key.lock().unwrap() = Some(key);
    Ok(())
}

#[tauri::command]
pub fn vault_unlock(state: State<AppState>, password: String) -> AppResult<()> {
    let conn = state.db.lock().unwrap();
    let key = store::unlock(&conn, &password)?;
    *state.vault_key.lock().unwrap() = Some(key);
    Ok(())
}

#[tauri::command]
pub fn vault_lock(state: State<AppState>) -> AppResult<()> {
    *state.vault_key.lock().unwrap() = None;
    Ok(())
}
