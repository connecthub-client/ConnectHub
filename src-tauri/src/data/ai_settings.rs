use rusqlite::Connection;

use crate::error::AppResult;
use crate::vault::crypto;
use crate::vault::kdf::VaultKey;

#[derive(Debug, Clone)]
pub struct AiProviderSecret {
    pub model: Option<String>,
    pub api_key: String,
}

pub fn get(
    conn: &Connection,
    key: &VaultKey,
    provider: &str,
) -> AppResult<Option<AiProviderSecret>> {
    let row: Option<(Option<String>, Vec<u8>, Vec<u8>)> = conn
        .query_row(
            "SELECT model, api_key_nonce, api_key_ciphertext FROM ai_provider_settings WHERE provider = ?1",
            (provider,),
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other),
        })?;

    let Some((model, nonce, ciphertext)) = row else {
        return Ok(None);
    };
    let plaintext = crypto::decrypt(key, &nonce, &ciphertext)?;
    let api_key = String::from_utf8(plaintext)
        .map_err(|_| crate::error::AppError::Crypto("stored API key is not valid UTF-8".into()))?;

    Ok(Some(AiProviderSecret { model, api_key }))
}

pub fn set(
    conn: &Connection,
    key: &VaultKey,
    provider: &str,
    api_key: &str,
    model: Option<&str>,
) -> AppResult<()> {
    let enc = crypto::encrypt(key, api_key.as_bytes())?;
    conn.execute(
        "INSERT INTO ai_provider_settings (provider, model, api_key_nonce, api_key_ciphertext)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(provider) DO UPDATE SET
            model = excluded.model,
            api_key_nonce = excluded.api_key_nonce,
            api_key_ciphertext = excluded.api_key_ciphertext",
        (provider, model, &enc.nonce[..], &enc.ciphertext[..]),
    )?;
    Ok(())
}

pub fn clear(conn: &Connection, provider: &str) -> AppResult<()> {
    conn.execute(
        "DELETE FROM ai_provider_settings WHERE provider = ?1",
        (provider,),
    )?;
    Ok(())
}

pub fn configured(conn: &Connection, provider: &str) -> AppResult<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM ai_provider_settings WHERE provider = ?1",
        (provider,),
        |row| row.get(0),
    )?;
    Ok(count > 0)
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
        assert!(get(&conn, &key, "openai").unwrap().is_none());
        assert!(!configured(&conn, "openai").unwrap());

        set(&conn, &key, "openai", "sk-test-123", Some("gpt-4o-mini")).unwrap();
        let secret = get(&conn, &key, "openai").unwrap().unwrap();
        assert_eq!(secret.api_key, "sk-test-123");
        assert_eq!(secret.model.as_deref(), Some("gpt-4o-mini"));
        assert!(configured(&conn, "openai").unwrap());
    }

    #[test]
    fn providers_are_stored_independently() {
        let conn = test_conn();
        let key = test_key();
        set(&conn, &key, "openai", "sk-openai", None).unwrap();
        set(&conn, &key, "anthropic", "sk-anthropic", None).unwrap();

        assert_eq!(
            get(&conn, &key, "openai").unwrap().unwrap().api_key,
            "sk-openai"
        );
        assert_eq!(
            get(&conn, &key, "anthropic").unwrap().unwrap().api_key,
            "sk-anthropic"
        );
    }

    #[test]
    fn set_twice_overwrites_rather_than_erroring() {
        let conn = test_conn();
        let key = test_key();
        set(&conn, &key, "openai", "sk-old", Some("model-a")).unwrap();
        set(&conn, &key, "openai", "sk-new", Some("model-b")).unwrap();

        let secret = get(&conn, &key, "openai").unwrap().unwrap();
        assert_eq!(secret.api_key, "sk-new");
        assert_eq!(secret.model.as_deref(), Some("model-b"));
    }

    #[test]
    fn clear_removes_stored_settings() {
        let conn = test_conn();
        let key = test_key();
        set(&conn, &key, "openai", "sk-test", None).unwrap();
        clear(&conn, "openai").unwrap();
        assert!(get(&conn, &key, "openai").unwrap().is_none());
        assert!(!configured(&conn, "openai").unwrap());
    }
}
