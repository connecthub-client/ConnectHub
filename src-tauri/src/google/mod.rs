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
    let tokens = oauth::login().await?;
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

// Downloads the vault + local secret from Drive and swaps them in for the
// ones this device currently has, then re-derives the vault key so the
// restored data is immediately usable without restarting the app.
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

    // Release the live connection's handle on vault.db before overwriting
    // the file out from under it.
    {
        let mut guard = state.db.lock().unwrap();
        *guard = rusqlite::Connection::open_in_memory()?;
    }

    std::fs::write(&state.db_path, &vault_bytes)?;
    store::write_local_secret(&secret)?;

    let new_conn = rusqlite::Connection::open(&state.db_path)?;
    data::init_schema(&new_conn)?;
    crate::ssh::known_hosts::init_schema(&new_conn)?;
    let key = store::auto_unlock(&new_conn)?;

    *state.db.lock().unwrap() = new_conn;
    *state.vault_key.lock().unwrap() = Some(key);

    Ok(())
}
