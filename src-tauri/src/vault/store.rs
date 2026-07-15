use rusqlite::Connection;
use std::path::PathBuf;

use super::crypto::{self};
use super::kdf::{self, KdfParams, VaultKey};
use crate::error::{AppError, AppResult};

const VERIFIER_PLAINTEXT: &[u8] = b"sshtool-vault-v1";

pub fn db_path() -> AppResult<PathBuf> {
    let mut dir = dirs::data_dir().ok_or_else(|| {
        AppError::Crypto("could not determine platform data directory".into())
    })?;
    dir.push("sshtool");
    std::fs::create_dir_all(&dir)?;
    dir.push("vault.db");
    Ok(dir)
}

pub fn init_schema(conn: &Connection) -> AppResult<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS vault_meta (
            id INTEGER PRIMARY KEY CHECK (id = 0),
            salt BLOB NOT NULL,
            kdf_m_cost INTEGER NOT NULL,
            kdf_t_cost INTEGER NOT NULL,
            kdf_p_cost INTEGER NOT NULL,
            verifier_nonce BLOB NOT NULL,
            verifier_ciphertext BLOB NOT NULL
        )",
        (),
    )?;
    Ok(())
}

pub fn open() -> AppResult<Connection> {
    let conn = Connection::open(db_path()?)?;
    init_schema(&conn)?;
    Ok(conn)
}

pub fn is_initialized(conn: &Connection) -> AppResult<bool> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM vault_meta WHERE id = 0", (), |row| {
        row.get(0)
    })?;
    Ok(count > 0)
}

pub fn create(conn: &Connection, password: &str) -> AppResult<VaultKey> {
    if is_initialized(conn)? {
        return Err(AppError::VaultAlreadyInitialized);
    }

    let salt = kdf::generate_salt();
    let params = KdfParams::default();
    let key = kdf::derive_key(password, &salt, &params)?;

    let verifier = crypto::encrypt(&key, VERIFIER_PLAINTEXT)?;

    conn.execute(
        "INSERT INTO vault_meta
            (id, salt, kdf_m_cost, kdf_t_cost, kdf_p_cost, verifier_nonce, verifier_ciphertext)
         VALUES (0, ?1, ?2, ?3, ?4, ?5, ?6)",
        (
            &salt[..],
            params.m_cost,
            params.t_cost,
            params.p_cost,
            &verifier.nonce[..],
            &verifier.ciphertext[..],
        ),
    )?;

    Ok(key)
}

pub fn unlock(conn: &Connection, password: &str) -> AppResult<VaultKey> {
    let row: Option<(Vec<u8>, u32, u32, u32, Vec<u8>, Vec<u8>)> = conn
        .query_row(
            "SELECT salt, kdf_m_cost, kdf_t_cost, kdf_p_cost, verifier_nonce, verifier_ciphertext
             FROM vault_meta WHERE id = 0",
            (),
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other),
        })?;

    let (salt, m_cost, t_cost, p_cost, verifier_nonce, verifier_ciphertext) =
        row.ok_or(AppError::VaultNotInitialized)?;

    let params = KdfParams {
        m_cost,
        t_cost,
        p_cost,
    };
    let key = kdf::derive_key(password, &salt, &params)?;

    let decrypted = crypto::decrypt(&key, &verifier_nonce, &verifier_ciphertext)
        .map_err(|_| AppError::InvalidPassword)?;
    if decrypted != VERIFIER_PLAINTEXT {
        return Err(AppError::InvalidPassword);
    }

    Ok(key)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        conn
    }

    #[test]
    fn create_then_unlock_with_correct_password_succeeds() {
        let conn = test_conn();
        create(&conn, "correct horse battery staple").unwrap();
        assert!(is_initialized(&conn).unwrap());

        let result = unlock(&conn, "correct horse battery staple");
        assert!(result.is_ok());
    }

    #[test]
    fn unlock_with_wrong_password_is_rejected() {
        let conn = test_conn();
        create(&conn, "correct horse battery staple").unwrap();

        let result = unlock(&conn, "totally wrong password");
        assert!(matches!(result, Err(AppError::InvalidPassword)));
    }

    #[test]
    fn unlock_before_create_fails() {
        let conn = test_conn();
        let result = unlock(&conn, "anything");
        assert!(matches!(result, Err(AppError::VaultNotInitialized)));
    }

    #[test]
    fn create_twice_fails() {
        let conn = test_conn();
        create(&conn, "first password").unwrap();
        let result = create(&conn, "second password");
        assert!(matches!(result, Err(AppError::VaultAlreadyInitialized)));
    }
}
