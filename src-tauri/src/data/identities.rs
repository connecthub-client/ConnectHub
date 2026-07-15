use rusqlite::Connection;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::identity::{AuthMethod, Identity, IdentityInput};
use crate::vault::crypto;
use crate::vault::kdf::VaultKey;

fn row_to_identity(row: &rusqlite::Row) -> rusqlite::Result<Identity> {
    let auth_method_str: String = row.get(3)?;
    let has_password: Option<Vec<u8>> = row.get(5)?;
    Ok(Identity {
        id: row.get(0)?,
        label: row.get(1)?,
        username: row.get(2)?,
        auth_method: AuthMethod::from_str(&auth_method_str).unwrap_or(AuthMethod::Password),
        ssh_key_id: row.get(4)?,
        has_password: has_password.is_some(),
    })
}

pub fn list(conn: &Connection) -> AppResult<Vec<Identity>> {
    let mut stmt = conn.prepare(
        "SELECT id, label, username, auth_method, ssh_key_id, password_ciphertext
         FROM identities ORDER BY label",
    )?;
    let rows = stmt.query_map((), row_to_identity)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn get(conn: &Connection, id: Uuid) -> AppResult<Identity> {
    conn.query_row(
        "SELECT id, label, username, auth_method, ssh_key_id, password_ciphertext
         FROM identities WHERE id = ?1",
        (&id,),
        row_to_identity,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => AppError::NotFound,
        other => AppError::Db(other),
    })
}

// Internal-only: used by the SSH connect flow, never exposed as a Tauri
// command. Returns the identity plus its decrypted password, if it has one.
pub fn get_with_decrypted_password(
    conn: &Connection,
    key: &VaultKey,
    id: Uuid,
) -> AppResult<(Identity, Option<String>)> {
    let identity = get(conn, id)?;

    let (nonce, ciphertext): (Option<Vec<u8>>, Option<Vec<u8>>) = conn.query_row(
        "SELECT password_nonce, password_ciphertext FROM identities WHERE id = ?1",
        (&id,),
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;

    let password = match (nonce, ciphertext) {
        (Some(nonce), Some(ciphertext)) => {
            let plaintext = crypto::decrypt(key, &nonce, &ciphertext)?;
            Some(
                String::from_utf8(plaintext)
                    .map_err(|_| AppError::Crypto("stored password is not valid UTF-8".into()))?,
            )
        }
        _ => None,
    };

    Ok((identity, password))
}

pub fn create(conn: &Connection, key: &VaultKey, input: IdentityInput) -> AppResult<Identity> {
    let id = Uuid::new_v4();
    let password = input.password.filter(|p| !p.is_empty());
    let (nonce, ciphertext): (Option<Vec<u8>>, Option<Vec<u8>>) = match &password {
        Some(p) => {
            let enc = crypto::encrypt(key, p.as_bytes())?;
            (Some(enc.nonce.to_vec()), Some(enc.ciphertext))
        }
        None => (None, None),
    };

    conn.execute(
        "INSERT INTO identities (id, label, username, auth_method, ssh_key_id, password_nonce, password_ciphertext)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            &id,
            &input.label,
            &input.username,
            input.auth_method.as_str(),
            &input.ssh_key_id,
            nonce,
            ciphertext,
        ],
    )?;

    Ok(Identity {
        id,
        label: input.label,
        username: input.username,
        auth_method: input.auth_method,
        ssh_key_id: input.ssh_key_id,
        has_password: password.is_some(),
    })
}

// `input.password`: None keeps the existing stored password unchanged,
// Some("") clears it, Some(p) replaces it - see IdentityInput's docs.
pub fn update(conn: &Connection, key: &VaultKey, id: Uuid, input: IdentityInput) -> AppResult<Identity> {
    let has_password = match input.password {
        Some(ref p) if !p.is_empty() => {
            let enc = crypto::encrypt(key, p.as_bytes())?;
            let changed = conn.execute(
                "UPDATE identities SET label = ?1, username = ?2, auth_method = ?3, ssh_key_id = ?4,
                    password_nonce = ?5, password_ciphertext = ?6 WHERE id = ?7",
                rusqlite::params![
                    &input.label,
                    &input.username,
                    input.auth_method.as_str(),
                    &input.ssh_key_id,
                    &enc.nonce[..],
                    &enc.ciphertext[..],
                    &id,
                ],
            )?;
            if changed == 0 {
                return Err(AppError::NotFound);
            }
            true
        }
        Some(_) => {
            // empty string: clear the stored password
            let changed = conn.execute(
                "UPDATE identities SET label = ?1, username = ?2, auth_method = ?3, ssh_key_id = ?4,
                    password_nonce = NULL, password_ciphertext = NULL WHERE id = ?5",
                rusqlite::params![
                    &input.label,
                    &input.username,
                    input.auth_method.as_str(),
                    &input.ssh_key_id,
                    &id,
                ],
            )?;
            if changed == 0 {
                return Err(AppError::NotFound);
            }
            false
        }
        None => {
            let changed = conn.execute(
                "UPDATE identities SET label = ?1, username = ?2, auth_method = ?3, ssh_key_id = ?4
                 WHERE id = ?5",
                rusqlite::params![
                    &input.label,
                    &input.username,
                    input.auth_method.as_str(),
                    &input.ssh_key_id,
                    &id,
                ],
            )?;
            if changed == 0 {
                return Err(AppError::NotFound);
            }
            let existing: Option<Vec<u8>> = conn.query_row(
                "SELECT password_ciphertext FROM identities WHERE id = ?1",
                (&id,),
                |row| row.get(0),
            )?;
            existing.is_some()
        }
    };

    Ok(Identity {
        id,
        label: input.label,
        username: input.username,
        auth_method: input.auth_method,
        ssh_key_id: input.ssh_key_id,
        has_password,
    })
}

pub fn delete(conn: &Connection, id: Uuid) -> AppResult<()> {
    let changed = conn.execute("DELETE FROM identities WHERE id = ?1", (&id,))?;
    if changed == 0 {
        return Err(AppError::NotFound);
    }
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

    fn input(password: Option<&str>) -> IdentityInput {
        IdentityInput {
            label: "prod server".into(),
            username: "deploy".into(),
            auth_method: AuthMethod::Password,
            ssh_key_id: None,
            password: password.map(String::from),
        }
    }

    #[test]
    fn create_without_password_reports_has_password_false() {
        let conn = test_conn();
        let key = test_key();
        let created = create(&conn, &key, input(None)).unwrap();
        assert!(!created.has_password);
    }

    #[test]
    fn create_with_password_reports_has_password_true_and_encrypts_it() {
        let conn = test_conn();
        let key = test_key();
        let created = create(&conn, &key, input(Some("s3cret"))).unwrap();
        assert!(created.has_password);

        let ciphertext: Vec<u8> = conn
            .query_row(
                "SELECT password_ciphertext FROM identities WHERE id = ?1",
                (&created.id,),
                |row| row.get(0),
            )
            .unwrap();
        assert_ne!(ciphertext, b"s3cret".to_vec());
    }

    #[test]
    fn update_with_none_password_leaves_existing_password_untouched() {
        let conn = test_conn();
        let key = test_key();
        let created = create(&conn, &key, input(Some("s3cret"))).unwrap();

        let updated = update(
            &conn,
            &key,
            created.id,
            IdentityInput {
                label: "renamed".into(),
                ..input(None)
            },
        )
        .unwrap();

        assert_eq!(updated.label, "renamed");
        assert!(updated.has_password, "password should survive an update that doesn't mention it");
    }

    #[test]
    fn update_with_empty_password_clears_it() {
        let conn = test_conn();
        let key = test_key();
        let created = create(&conn, &key, input(Some("s3cret"))).unwrap();

        let updated = update(&conn, &key, created.id, input(Some(""))).unwrap();
        assert!(!updated.has_password);
    }

    #[test]
    fn get_with_decrypted_password_roundtrips_the_plaintext() {
        let conn = test_conn();
        let key = test_key();
        let created = create(&conn, &key, input(Some("s3cret"))).unwrap();

        let (identity, password) = get_with_decrypted_password(&conn, &key, created.id).unwrap();
        assert_eq!(identity.id, created.id);
        assert_eq!(password.as_deref(), Some("s3cret"));
    }

    #[test]
    fn get_with_decrypted_password_is_none_when_no_password_set() {
        let conn = test_conn();
        let key = test_key();
        let created = create(&conn, &key, input(None)).unwrap();

        let (_, password) = get_with_decrypted_password(&conn, &key, created.id).unwrap();
        assert_eq!(password, None);
    }

    #[test]
    fn update_nonexistent_identity_fails() {
        let conn = test_conn();
        let key = test_key();
        let result = update(&conn, &key, Uuid::new_v4(), input(None));
        assert!(matches!(result, Err(AppError::NotFound)));
    }
}
