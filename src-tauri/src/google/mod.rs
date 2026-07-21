pub mod drive;
pub mod oauth;

use std::time::Duration;

use serde::Serialize;

use crate::data;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::vault::store;

// Deliberately not renamed alongside the app (Termora -> ConnectHub): these
// are the filenames used in every backup already sitting in a user's Drive
// appDataFolder. Changing them would make restore_from_drive stop finding
// backups made before the rename - same reasoning as vault::store::db_path
// keeping the literal "sshtool" independent of the product name.
const VAULT_FILE_NAME: &str = "termora-vault.db";
const SECRET_FILE_NAME: &str = "termora-local-secret";

#[derive(Serialize, Clone)]
pub struct GoogleAuthStatus {
    pub connected: bool,
    pub email: Option<String>,
}

pub fn status(state: &AppState) -> AppResult<GoogleAuthStatus> {
    let conn = state.db.lock().unwrap();
    let auth = state.with_key(|key| data::google_auth::get(&conn, key))?;
    Ok(match auth {
        Some(a) => GoogleAuthStatus {
            connected: true,
            email: a.account_email,
        },
        None => GoogleAuthStatus {
            connected: false,
            email: None,
        },
    })
}

pub async fn login(state: &AppState) -> AppResult<GoogleAuthStatus> {
    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel();
    *state.google_login_cancel.lock().unwrap() = Some(cancel_tx);

    let result = oauth::login(cancel_rx).await;
    // Whether it succeeded, failed, or was cancelled, there's no longer a
    // pending sign-in to cancel - clear it so a stale sender (which would
    // just be ignored anyway, since the receiver is already gone) doesn't
    // linger.
    state.google_login_cancel.lock().unwrap().take();
    let tokens = result?;

    let refresh_token = tokens.refresh_token.ok_or_else(|| {
        AppError::Google(
            "Google did not return a refresh token - please try signing in again".into(),
        )
    })?;
    let email = oauth::fetch_email(&tokens.access_token).await.unwrap_or(None);

    {
        let conn = state.db.lock().unwrap();
        state.with_key(|key| data::google_auth::set(&conn, key, email.as_deref(), &refresh_token))?;
    }

    Ok(GoogleAuthStatus {
        connected: true,
        email,
    })
}

// Lets the frontend abort a pending login() early - the only way to get
// unstuck if the user closes the browser tab without finishing the flow,
// since the loopback server has no way to detect that on its own. A no-op
// if nothing is currently pending.
pub fn cancel_login(state: &AppState) {
    if let Some(tx) = state.google_login_cancel.lock().unwrap().take() {
        let _ = tx.send(());
    }
}

pub fn logout(state: &AppState) -> AppResult<()> {
    let conn = state.db.lock().unwrap();
    data::google_auth::clear(&conn)
}

async fn get_access_token(state: &AppState) -> AppResult<String> {
    let refresh_token = {
        let conn = state.db.lock().unwrap();
        let auth = state.with_key(|key| data::google_auth::get(&conn, key))?;
        auth.ok_or_else(|| AppError::Google("not signed in to Google".into()))?
            .refresh_token
    };
    oauth::refresh_access_token(&refresh_token).await
}

// Copies the live database through SQLite's own backup API rather than
// reading vault.db's bytes directly off disk - the file alone isn't a
// reliable snapshot while another connection has it open (mid-write state,
// journal not yet checkpointed), the backup API is.
fn snapshot_vault_bytes(state: &AppState) -> AppResult<Vec<u8>> {
    let tmp_path = std::env::temp_dir().join(format!("termora-vault-snapshot-{}.db", uuid::Uuid::new_v4()));
    {
        let mut dst = rusqlite::Connection::open(&tmp_path)?;
        let src = state.db.lock().unwrap();
        let backup = rusqlite::backup::Backup::new(&src, &mut dst)?;
        backup.run_to_completion(5, Duration::from_millis(250), None)?;
    }
    let bytes = std::fs::read(&tmp_path)?;
    std::fs::remove_file(&tmp_path).ok();
    Ok(bytes)
}

pub async fn backup_now(state: &AppState) -> AppResult<()> {
    let access_token = get_access_token(state).await?;

    let vault_bytes = snapshot_vault_bytes(state)?;
    let secret_bytes = std::fs::read(store::local_secret_path()?)?;

    drive::upsert(&access_token, VAULT_FILE_NAME, vault_bytes).await?;
    drive::upsert(&access_token, SECRET_FILE_NAME, secret_bytes).await?;
    Ok(())
}

// Writes `vault_bytes`/`secret` to disk and opens+unlocks the result -
// shared by both the actual restore below and its rollback path, since both
// need exactly the same "write, open, init schema, auto-unlock" sequence,
// just with different bytes.
fn write_and_open_vault(
    db_path: &std::path::Path,
    secret_path: &std::path::Path,
    vault_bytes: &[u8],
    secret: &str,
) -> AppResult<(rusqlite::Connection, crate::vault::VaultKey)> {
    std::fs::write(db_path, vault_bytes)?;
    std::fs::write(secret_path, secret)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(secret_path, std::fs::Permissions::from_mode(0o600))?;
    }

    let conn = rusqlite::Connection::open(db_path)?;
    data::init_schema(&conn)?;
    crate::ssh::known_hosts::init_schema(&conn)?;
    // `unlock`, not `auto_unlock`: the latter reads the secret from
    // whatever `local_secret_path()` resolves to on this machine right
    // now, ignoring `secret_path` above entirely - fine in production
    // today since restore_from_drive always passes the real path for
    // both, but fragile, and wrong for rollback (which needs to unlock
    // with the pre-restore secret we already have in hand, not re-read
    // whatever is currently on disk). A vault reaching this function was
    // already auto_unlock'd (and therefore already past the legacy-
    // password migration) on whichever device backed it up, so the
    // legacy-password fallback auto_unlock also handles isn't needed here.
    let key = store::unlock(&conn, secret)?;
    Ok((conn, key))
}

// Downloads the vault + local secret from Drive and swaps them in for the
// ones this device currently has, then re-derives the vault key so the
// restored data is immediately usable without restarting the app.
//
// The pre-restore vault.db/local secret are snapshotted before any
// destructive write, and restored if anything below fails - without this,
// a failure partway through (disk full, a truncated/corrupt download,
// auto_unlock rejecting the downloaded pair) would leave real files on
// disk half-written or mismatched, with the running app stuck on the
// throwaway in-memory connection needed to release the file handle first.
pub async fn restore_from_drive(state: &AppState) -> AppResult<()> {
    let access_token = get_access_token(state).await?;

    let vault_file = drive::find_file(&access_token, VAULT_FILE_NAME)
        .await?
        .ok_or_else(|| AppError::Google("no backup found in Google Drive for this account".into()))?;
    let secret_file = drive::find_file(&access_token, SECRET_FILE_NAME)
        .await?
        .ok_or_else(|| {
            AppError::Google(
                "backup is incomplete (missing local secret) - back up again from the original device".into(),
            )
        })?;

    let vault_bytes = drive::download_content(&access_token, &vault_file.id).await?;
    let secret_bytes = drive::download_content(&access_token, &secret_file.id).await?;
    let secret = String::from_utf8(secret_bytes)
        .map_err(|_| AppError::Google("restored secret file is not valid UTF-8".into()))?;

    let secret_path = store::local_secret_path()?;
    let original_vault_bytes = std::fs::read(&state.db_path)?;
    let original_secret = std::fs::read_to_string(&secret_path)?;

    // Release the live connection's handle on vault.db before overwriting
    // the file out from under it.
    {
        let mut guard = state.db.lock().unwrap();
        *guard = rusqlite::Connection::open_in_memory()?;
    }

    match write_and_open_vault(&state.db_path, &secret_path, &vault_bytes, &secret) {
        Ok((conn, key)) => {
            *state.db.lock().unwrap() = conn;
            *state.vault_key.lock().unwrap() = Some(key);
            Ok(())
        }
        Err(e) => {
            // Best-effort: if the rollback write itself also fails, the
            // original error `e` is still what gets reported, but we've at
            // least tried to leave the user's real vault in place rather
            // than the half-restored one.
            if let Ok((conn, key)) =
                write_and_open_vault(&state.db_path, &secret_path, &original_vault_bytes, &original_secret)
            {
                *state.db.lock().unwrap() = conn;
                *state.vault_key.lock().unwrap() = Some(key);
            }
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_and_open_vault_opens_and_unlocks_a_valid_vault() {
        let dir = std::env::temp_dir().join(format!("connecthub-test-restore-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("vault.db");
        let secret_path = dir.join(".local_secret");

        let secret = "original-secret-value";
        let vault_bytes = {
            let conn = rusqlite::Connection::open(&db_path).unwrap();
            store::init_schema(&conn).unwrap();
            store::create(&conn, secret).unwrap();
            drop(conn);
            std::fs::read(&db_path).unwrap()
        };
        std::fs::remove_file(&db_path).unwrap();

        let (_, _key) = write_and_open_vault(&db_path, &secret_path, &vault_bytes, secret)
            .expect("a valid vault + matching secret must open and unlock");

        assert_eq!(std::fs::read_to_string(&secret_path).unwrap(), secret);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn rollback_after_a_failed_restore_recovers_the_original_vault() {
        let dir = std::env::temp_dir().join(format!("connecthub-test-restore-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("vault.db");
        let secret_path = dir.join(".local_secret");

        // Set up a genuinely-working "original" vault, as if this were the
        // state right before a restore was attempted.
        let original_secret = "original-secret-value";
        {
            let conn = rusqlite::Connection::open(&db_path).unwrap();
            store::init_schema(&conn).unwrap();
            store::create(&conn, original_secret).unwrap();
        }
        std::fs::write(&secret_path, original_secret).unwrap();
        let original_vault_bytes = std::fs::read(&db_path).unwrap();

        // A "restored" vault paired with the wrong secret must fail to
        // unlock (simulates a corrupt download or a mismatched pair)
        // without touching the caller's snapshot of the original bytes.
        let bad_vault_bytes = {
            let bad_dir = dir.join("bad");
            std::fs::create_dir_all(&bad_dir).unwrap();
            let bad_db = bad_dir.join("vault.db");
            let conn = rusqlite::Connection::open(&bad_db).unwrap();
            store::init_schema(&conn).unwrap();
            store::create(&conn, "a-completely-different-secret").unwrap();
            drop(conn);
            std::fs::read(&bad_db).unwrap()
        };
        let result = write_and_open_vault(&db_path, &secret_path, &bad_vault_bytes, original_secret);
        assert!(result.is_err(), "wrong secret for the downloaded vault must fail to unlock");

        // Rollback: writing the ORIGINAL snapshot back must succeed and
        // unlock exactly as it did before the failed restore.
        let (_, _key) = write_and_open_vault(&db_path, &secret_path, &original_vault_bytes, original_secret)
            .expect("rolling back to the original vault bytes must succeed");

        std::fs::remove_dir_all(&dir).ok();
    }
}
