use tauri::State;

use crate::error::AppResult;
use crate::state::AppState;
use crate::vault::store;

// The app has no master-password prompt - it unlocks itself on launch (and
// again after a restore) using a per-installation secret store::auto_unlock
// manages internally. See vault/store.rs for why that secret is generated
// locally rather than being a fixed constant.
#[tauri::command]
pub fn vault_auto_unlock(state: State<AppState>) -> AppResult<()> {
    let conn = state.db.lock().unwrap();
    let key = store::auto_unlock(&conn)?;
    *state.vault_key.lock().unwrap() = Some(key);
    Ok(())
}
