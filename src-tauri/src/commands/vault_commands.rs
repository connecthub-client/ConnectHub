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

// Clears the in-memory key so every subsequent AppState::with_key call
// fails with VaultLocked until the frontend calls vault_auto_unlock again
// (via the "Unlock" button on the idle-lock overlay) - a real enforcement
// point, not just a UI overlay, since e.g. connecting with a password/key
// identity genuinely can't decrypt its secret while locked. There is still
// no separate master password here: "unlock" re-derives the same
// per-installation secret auto_unlock already uses, which is idempotent
// (see vault::store::auto_unlock - unlock() succeeds directly on the
// already-migrated vault, so the legacy-password migration path is never
// re-entered on a second call).
#[tauri::command]
pub fn vault_lock(state: State<AppState>) -> AppResult<()> {
    *state.vault_key.lock().unwrap() = None;
    Ok(())
}
