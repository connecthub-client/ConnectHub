use rusqlite::Connection;

use crate::error::AppResult;
use crate::vault::crypto;
use crate::vault::kdf::VaultKey;

#[derive(Debug, Clone)]
pub struct GoogleAuth {
    pub account_email: Option<String>,
    pub refresh_token: String,
}

pub fn get(conn: &Connection, key: &VaultKey) -> AppResult<Option<GoogleAuth>> {
    let row: Option<(Option<String>, Vec<u8>, Vec<u8>)> = conn
        .query_row(
            "SELECT account_email, refresh_token_nonce, refresh_token_ciphertext
             FROM google_auth WHERE id = 0",
            (),
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other),
        })?;

    let Some((account_email, nonce, ciphertext)) = row else {
        return Ok(None);
    };
    let plaintext = crypto::decrypt(key, &nonce, &ciphertext)?;
    let refresh_token = String::from_utf8(plaintext)
        .map_err(|_| crate::error::AppError::Crypto("stored refresh token is not valid UTF-8".into()))?;

    Ok(Some(GoogleAuth {
        account_email,
        refresh_token,
    }))
}

pub fn set(
    conn: &Connection,
    key: &VaultKey,
    account_email: Option<&str>,
    refresh_token: &str,
) -> AppResult<()> {
    let enc = crypto::encrypt(key, refresh_token.as_bytes())?;
    conn.execute(
        "INSERT INTO google_auth (id, account_email, refresh_token_nonce, refresh_token_ciphertext)
         VALUES (0, ?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET
            account_email = excluded.account_email,
            refresh_token_nonce = excluded.refresh_token_nonce,
            refresh_token_ciphertext = excluded.refresh_token_ciphertext",
        (account_email, &enc.nonce[..], &enc.ciphertext[..]),
    )?;
    Ok(())
}

pub fn clear(conn: &Connection) -> AppResult<()> {
    conn.execute("DELETE FROM google_auth WHERE id = 0", ())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::kdf::test_key;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::data::init_schema(&conn).unwrap();
        conn
    }

    #[test]
    fn set_then_get_roundtrips() {
        let conn = test_conn();
        let key = test_key();
        assert!(get(&conn, &key).unwrap().is_none());

        set(&conn, &key, Some("a@example.com"), "refresh-token-123").unwrap();
        let auth = get(&conn, &key).unwrap().unwrap();
        assert_eq!(auth.account_email.as_deref(), Some("a@example.com"));
        assert_eq!(auth.refresh_token, "refresh-token-123");
    }

    #[test]
    fn set_twice_overwrites_rather_than_erroring() {
        let conn = test_conn();
        let key = test_key();
        set(&conn, &key, Some("a@example.com"), "token-1").unwrap();
        set(&conn, &key, Some("b@example.com"), "token-2").unwrap();

        let auth = get(&conn, &key).unwrap().unwrap();
        assert_eq!(auth.account_email.as_deref(), Some("b@example.com"));
        assert_eq!(auth.refresh_token, "token-2");
    }

    #[test]
    fn clear_removes_stored_auth() {
        let conn = test_conn();
        let key = test_key();
        set(&conn, &key, None, "token").unwrap();
        clear(&conn).unwrap();
        assert!(get(&conn, &key).unwrap().is_none());
    }
}
