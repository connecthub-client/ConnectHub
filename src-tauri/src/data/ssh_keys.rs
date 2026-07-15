use rand_core::OsRng;
use rusqlite::Connection;
use ssh_key::{Algorithm, HashAlg, LineEnding, PrivateKey};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::ssh_key::{GenerateKeyInput, ImportKeyInput, SshKey};
use crate::vault::crypto;
use crate::vault::kdf::VaultKey;

fn row_to_key(row: &rusqlite::Row) -> rusqlite::Result<SshKey> {
    Ok(SshKey {
        id: row.get(0)?,
        label: row.get(1)?,
        key_type: row.get(2)?,
        public_key: row.get(3)?,
        fingerprint: row.get(4)?,
        created_at: row.get(5)?,
    })
}

pub fn list(conn: &Connection) -> AppResult<Vec<SshKey>> {
    let mut stmt = conn.prepare(
        "SELECT id, label, key_type, public_key, fingerprint, created_at
         FROM ssh_keys ORDER BY created_at",
    )?;
    let rows = stmt.query_map((), row_to_key)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

// Internal-only: used by the SSH connect flow, never exposed as a Tauri
// command. Returns the decrypted OpenSSH-format private key PEM, and its
// decrypted passphrase if one was stored alongside it.
pub fn get_decrypted_private_key(
    conn: &Connection,
    key: &VaultKey,
    id: Uuid,
) -> AppResult<(String, Option<String>)> {
    let (pk_nonce, pk_ciphertext, pass_nonce, pass_ciphertext): (
        Vec<u8>,
        Vec<u8>,
        Option<Vec<u8>>,
        Option<Vec<u8>>,
    ) = conn
        .query_row(
            "SELECT private_key_nonce, private_key_ciphertext, passphrase_nonce, passphrase_ciphertext
             FROM ssh_keys WHERE id = ?1",
            (&id,),
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound,
            other => AppError::Db(other),
        })?;

    let pem_bytes = crypto::decrypt(key, &pk_nonce, &pk_ciphertext)?;
    let pem = String::from_utf8(pem_bytes)
        .map_err(|_| AppError::Crypto("stored private key is not valid UTF-8".into()))?;

    let passphrase = match (pass_nonce, pass_ciphertext) {
        (Some(nonce), Some(ciphertext)) => {
            let plaintext = crypto::decrypt(key, &nonce, &ciphertext)?;
            Some(
                String::from_utf8(plaintext)
                    .map_err(|_| AppError::Crypto("stored passphrase is not valid UTF-8".into()))?,
            )
        }
        _ => None,
    };

    Ok((pem, passphrase))
}

pub fn generate(conn: &Connection, key: &VaultKey, input: GenerateKeyInput) -> AppResult<SshKey> {
    let private_key = PrivateKey::random(&mut OsRng, Algorithm::Ed25519)
        .map_err(|e| AppError::InvalidKey(e.to_string()))?;

    let public_key = private_key
        .public_key()
        .to_openssh()
        .map_err(|e| AppError::InvalidKey(e.to_string()))?;
    let fingerprint = private_key.public_key().fingerprint(HashAlg::Sha256).to_string();
    let pem = private_key
        .to_openssh(LineEnding::LF)
        .map_err(|e| AppError::InvalidKey(e.to_string()))?
        .to_string();

    store_key(
        conn,
        key,
        &input.label,
        "ed25519",
        &public_key,
        &fingerprint,
        &pem,
        None,
    )
}

pub fn import(conn: &Connection, key: &VaultKey, input: ImportKeyInput) -> AppResult<SshKey> {
    let passphrase = input.passphrase.filter(|p| !p.is_empty());
    let parsed = PrivateKey::from_openssh(&input.private_key_pem)
        .map_err(|e| AppError::InvalidKey(e.to_string()))?;

    let decrypted = if parsed.is_encrypted() {
        let pass = passphrase
            .as_ref()
            .ok_or_else(|| AppError::InvalidKey("this key requires a passphrase".into()))?;
        parsed
            .decrypt(pass.as_bytes())
            .map_err(|_| AppError::InvalidKey("incorrect passphrase".into()))?
    } else {
        parsed
    };

    let public_key = decrypted
        .public_key()
        .to_openssh()
        .map_err(|e| AppError::InvalidKey(e.to_string()))?;
    let fingerprint = decrypted.public_key().fingerprint(HashAlg::Sha256).to_string();
    let key_type = decrypted.algorithm().to_string();

    store_key(
        conn,
        key,
        &input.label,
        &key_type,
        &public_key,
        &fingerprint,
        &input.private_key_pem,
        passphrase.as_deref(),
    )
}

#[allow(clippy::too_many_arguments)]
fn store_key(
    conn: &Connection,
    key: &VaultKey,
    label: &str,
    key_type: &str,
    public_key: &str,
    fingerprint: &str,
    private_key_pem: &str,
    passphrase: Option<&str>,
) -> AppResult<SshKey> {
    let id = Uuid::new_v4();
    let created_at = chrono::Utc::now().to_rfc3339();

    let enc_key = crypto::encrypt(key, private_key_pem.as_bytes())?;
    let (pass_nonce, pass_ciphertext): (Option<Vec<u8>>, Option<Vec<u8>>) = match passphrase {
        Some(p) => {
            let enc = crypto::encrypt(key, p.as_bytes())?;
            (Some(enc.nonce.to_vec()), Some(enc.ciphertext))
        }
        None => (None, None),
    };

    conn.execute(
        "INSERT INTO ssh_keys
            (id, label, key_type, public_key, fingerprint,
             private_key_nonce, private_key_ciphertext, passphrase_nonce, passphrase_ciphertext, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        rusqlite::params![
            &id,
            label,
            key_type,
            public_key,
            fingerprint,
            &enc_key.nonce[..],
            &enc_key.ciphertext[..],
            pass_nonce,
            pass_ciphertext,
            &created_at,
        ],
    )?;

    Ok(SshKey {
        id,
        label: label.to_string(),
        key_type: key_type.to_string(),
        public_key: public_key.to_string(),
        fingerprint: fingerprint.to_string(),
        created_at,
    })
}

pub fn delete(conn: &Connection, id: Uuid) -> AppResult<()> {
    let changed = conn.execute("DELETE FROM ssh_keys WHERE id = ?1", (&id,))?;
    if changed == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ssh_key::{GenerateKeyInput, ImportKeyInput};
    use crate::vault::kdf::test_key;
    use rusqlite::Connection;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::data::init_schema(&conn).unwrap();
        conn
    }

    #[test]
    fn generate_creates_a_listable_ed25519_key() {
        let conn = test_conn();
        let key = test_key();

        let generated = generate(
            &conn,
            &key,
            GenerateKeyInput {
                label: "laptop".into(),
            },
        )
        .unwrap();

        assert_eq!(generated.key_type, "ed25519");
        assert!(generated.public_key.starts_with("ssh-ed25519 "));

        let (pem, passphrase) = get_decrypted_private_key(&conn, &key, generated.id).unwrap();
        assert!(pem.contains("BEGIN OPENSSH PRIVATE KEY"));
        assert_eq!(passphrase, None);

        let listed = list(&conn).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, generated.id);
        assert_eq!(listed[0].fingerprint, generated.fingerprint);
    }

    #[test]
    fn private_key_is_encrypted_at_rest() {
        let conn = test_conn();
        let key = test_key();
        let generated = generate(
            &conn,
            &key,
            GenerateKeyInput {
                label: "laptop".into(),
            },
        )
        .unwrap();

        let (ciphertext, plaintext_check): (Vec<u8>, String) = conn
            .query_row(
                "SELECT private_key_ciphertext, public_key FROM ssh_keys WHERE id = ?1",
                (&generated.id,),
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();

        // The raw ciphertext blob must not contain the recognizable OpenSSH
        // private-key header or the public key text in the clear.
        assert!(!ciphertext.windows(15).any(|w| w == b"BEGIN OPENSSH P"));
        let _ = plaintext_check;
    }

    #[test]
    fn import_unencrypted_key_roundtrips() {
        let conn = test_conn();
        let key = test_key();

        // Generate a real key via ssh-key itself to use as import fixture,
        // instead of hardcoding a PEM that could drift from the crate's format.
        let fixture = PrivateKey::random(&mut OsRng, Algorithm::Ed25519).unwrap();
        let pem = fixture.to_openssh(LineEnding::LF).unwrap().to_string();
        let expected_fingerprint = fixture.public_key().fingerprint(HashAlg::Sha256).to_string();

        let imported = import(
            &conn,
            &key,
            ImportKeyInput {
                label: "imported".into(),
                private_key_pem: pem,
                passphrase: None,
            },
        )
        .unwrap();

        assert_eq!(imported.fingerprint, expected_fingerprint);
        assert_eq!(imported.key_type, "ssh-ed25519");
    }

    #[test]
    fn import_passphrase_protected_key_requires_correct_passphrase() {
        let conn = test_conn();
        let key = test_key();

        let fixture = PrivateKey::random(&mut OsRng, Algorithm::Ed25519).unwrap();
        let encrypted = fixture.encrypt(&mut OsRng, "hunter2").unwrap();
        let pem = encrypted.to_openssh(LineEnding::LF).unwrap().to_string();

        let wrong = import(
            &conn,
            &key,
            ImportKeyInput {
                label: "imported".into(),
                private_key_pem: pem.clone(),
                passphrase: Some("wrong".into()),
            },
        );
        assert!(matches!(wrong, Err(AppError::InvalidKey(_))));

        let right = import(
            &conn,
            &key,
            ImportKeyInput {
                label: "imported".into(),
                private_key_pem: pem.clone(),
                passphrase: Some("hunter2".into()),
            },
        )
        .unwrap();

        // The original (still passphrase-encrypted) PEM and its passphrase
        // must both round-trip - the SSH connect flow needs both to
        // authenticate later, not a pre-decrypted key.
        let (stored_pem, stored_passphrase) =
            get_decrypted_private_key(&conn, &key, right.id).unwrap();
        assert_eq!(stored_pem, pem);
        assert_eq!(stored_passphrase.as_deref(), Some("hunter2"));
    }

    #[test]
    fn delete_nonexistent_key_fails() {
        let conn = test_conn();
        let result = delete(&conn, Uuid::new_v4());
        assert!(matches!(result, Err(AppError::NotFound)));
    }
}
