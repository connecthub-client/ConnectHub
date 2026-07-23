use base64::Engine;
use rand::RngCore;
use rusqlite::Connection;
use std::path::PathBuf;
use uuid::Uuid;

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
    open_at(&db_path()?)
}

fn open_at(path: &std::path::Path) -> AppResult<Connection> {
    let conn = Connection::open(path)?;
    // SQLite's default busy_timeout is 0 - any write that finds the file
    // already locked fails immediately with SQLITE_BUSY rather than
    // waiting. This connection is normally the only writer (guarded by
    // AppState.db's Mutex), but `ssh::known_hosts::verify_or_trust` opens
    // its own short-lived connection to this same file on every SSH
    // connect attempt (see its own comment for why) - without a
    // busy_timeout here, a host CRUD/snippet/etc. write that happens to
    // land in the same instant as one of those brief transactions would
    // surface as a spurious "database is locked" error instead of just
    // waiting the few milliseconds needed.
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    init_schema(&conn)?;
    // vault.db holds every encrypted secret (identity passwords, private
    // keys, passphrases, VPN passwords, the Google refresh token) - harden
    // it the same way its sibling secret files already are (.local_secret,
    // VPN profile files), rather than leaving it at the OS/umask default
    // (often world-readable). Applied unconditionally on every open, not
    // just creation, so an existing vault.db from before this check existed
    // gets hardened retroactively too.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(conn)
}

pub fn local_secret_path() -> AppResult<PathBuf> {
    let mut dir = dirs::data_dir().ok_or_else(|| {
        AppError::Crypto("could not determine platform data directory".into())
    })?;
    dir.push("sshtool");
    std::fs::create_dir_all(&dir)?;
    dir.push(".local_secret");
    Ok(dir)
}

// There is no user-facing master password prompt - the app unlocks itself
// on launch. Unlike an earlier version of this file, the password used to
// do that is a per-installation random secret generated on first run and
// kept ONLY in this local file (never in source control), not a constant
// baked into the (public) app binary. That matters the moment the vault
// ever leaves this machine (e.g. a cloud backup): a fixed public password
// would make any copy of the encrypted vault trivially decryptable by
// anyone who can read the source, whereas this secret is only ever as
// exposed as the machine (or backup) it lives on.
fn get_or_create_local_secret() -> AppResult<String> {
    get_or_create_local_secret_at(&local_secret_path()?)
}

fn get_or_create_local_secret_at(path: &std::path::Path) -> AppResult<String> {
    if let Ok(existing) = std::fs::read_to_string(path) {
        let trimmed = existing.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }

    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let secret = base64::engine::general_purpose::STANDARD.encode(bytes);

    std::fs::write(path, &secret)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }

    Ok(secret)
}

// Password baked into the app between the "disable master password" change
// and the introduction of per-installation secrets above - a public
// constant (visible in source control), so any vault still encrypted under
// it is migrated to a real random secret the first time this code runs
// against it, rather than left on a password anyone can read on GitHub.
const LEGACY_PUBLIC_PASSWORD: &str = "CorrectHorseBattery1";

pub fn auto_unlock(conn: &Connection) -> AppResult<VaultKey> {
    let secret = get_or_create_local_secret()?;

    if !is_initialized(conn)? {
        return create(conn, &secret);
    }

    match unlock(conn, &secret) {
        Ok(key) => Ok(key),
        Err(AppError::InvalidPassword) => match unlock(conn, LEGACY_PUBLIC_PASSWORD) {
            Ok(legacy_key) => migrate_to_new_secret(conn, &legacy_key, &secret),
            Err(_) => Err(AppError::InvalidPassword),
        },
        Err(e) => Err(e),
    }
}

// Re-encrypts every secret field (identity passwords, ssh key private keys
// and passphrases) from `old_key` to a freshly derived key, then replaces
// vault_meta so the vault can only ever be unlocked with the new secret
// from here on. Used once per vault, the first time auto_unlock encounters
// one still protected by the old public constant password.
fn migrate_to_new_secret(
    conn: &Connection,
    old_key: &VaultKey,
    new_password: &str,
) -> AppResult<VaultKey> {
    let salt = kdf::generate_salt();
    let params = KdfParams::default();
    let new_key = kdf::derive_key(new_password, &salt, &params)?;

    let mut stmt = conn.prepare(
        "SELECT id, password_nonce, password_ciphertext FROM identities
         WHERE password_ciphertext IS NOT NULL",
    )?;
    let identity_rows: Vec<(Uuid, Vec<u8>, Vec<u8>)> = stmt
        .query_map((), |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
        .collect::<Result<_, _>>()?;
    drop(stmt);
    for (id, nonce, ciphertext) in identity_rows {
        let plaintext = crypto::decrypt(old_key, &nonce, &ciphertext)?;
        let enc = crypto::encrypt(&new_key, &plaintext)?;
        conn.execute(
            "UPDATE identities SET password_nonce = ?1, password_ciphertext = ?2 WHERE id = ?3",
            (&enc.nonce[..], &enc.ciphertext[..], &id),
        )?;
    }

    let mut stmt = conn.prepare(
        "SELECT id, private_key_nonce, private_key_ciphertext, passphrase_nonce, passphrase_ciphertext
         FROM ssh_keys",
    )?;
    let key_rows: Vec<(Uuid, Vec<u8>, Vec<u8>, Option<Vec<u8>>, Option<Vec<u8>>)> = stmt
        .query_map((), |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        })?
        .collect::<Result<_, _>>()?;
    drop(stmt);
    for (id, pk_nonce, pk_ciphertext, pass_nonce, pass_ciphertext) in key_rows {
        let pk_plaintext = crypto::decrypt(old_key, &pk_nonce, &pk_ciphertext)?;
        let pk_enc = crypto::encrypt(&new_key, &pk_plaintext)?;

        let new_pass: (Option<Vec<u8>>, Option<Vec<u8>>) = match (pass_nonce, pass_ciphertext) {
            (Some(n), Some(c)) => {
                let plaintext = crypto::decrypt(old_key, &n, &c)?;
                let enc = crypto::encrypt(&new_key, &plaintext)?;
                (Some(enc.nonce.to_vec()), Some(enc.ciphertext))
            }
            _ => (None, None),
        };

        conn.execute(
            "UPDATE ssh_keys SET private_key_nonce = ?1, private_key_ciphertext = ?2,
                passphrase_nonce = ?3, passphrase_ciphertext = ?4 WHERE id = ?5",
            (
                &pk_enc.nonce[..],
                &pk_enc.ciphertext[..],
                new_pass.0,
                new_pass.1,
                &id,
            ),
        )?;
    }

    let verifier = crypto::encrypt(&new_key, VERIFIER_PLAINTEXT)?;
    conn.execute(
        "UPDATE vault_meta SET salt = ?1, kdf_m_cost = ?2, kdf_t_cost = ?3, kdf_p_cost = ?4,
            verifier_nonce = ?5, verifier_ciphertext = ?6 WHERE id = 0",
        (
            &salt[..],
            params.m_cost,
            params.t_cost,
            params.p_cost,
            &verifier.nonce[..],
            &verifier.ciphertext[..],
        ),
    )?;

    Ok(new_key)
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

    fn temp_secret_path() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("sshtool-test-secret-{}", uuid::Uuid::new_v4()))
    }

    #[test]
    fn local_secret_is_generated_once_and_reused() {
        let path = temp_secret_path();
        let first = get_or_create_local_secret_at(&path).unwrap();
        assert!(!first.is_empty());

        let second = get_or_create_local_secret_at(&path).unwrap();
        assert_eq!(first, second, "the same file must yield the same secret every time");

        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn local_secret_differs_per_installation() {
        let a = get_or_create_local_secret_at(&temp_secret_path()).unwrap();
        let b = get_or_create_local_secret_at(&temp_secret_path()).unwrap();
        assert_ne!(a, b, "each fresh install must get its own random secret");
    }

    #[cfg(unix)]
    #[test]
    fn open_hardens_vault_db_to_0600_even_if_it_already_existed_with_looser_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let path = std::env::temp_dir().join(format!("sshtool-test-vault-{}.db", uuid::Uuid::new_v4()));
        // Simulate a vault.db that predates this permission check, created
        // under a permissive umask.
        std::fs::write(&path, b"").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();

        let _conn = open_at(&path).unwrap();

        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "vault.db must be hardened to 0600 on open, retroactively too");

        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn auto_unlock_creates_then_reuses_the_vault() {
        let conn = test_conn();
        let path = temp_secret_path();
        let secret = get_or_create_local_secret_at(&path).unwrap();
        assert!(!is_initialized(&conn).unwrap());

        create(&conn, &secret).unwrap();
        let first = unlock(&conn, &secret);
        assert!(first.is_ok());

        // A second "auto_unlock" (using the same persisted secret, matching
        // what a real restart does) must succeed against the now-initialized
        // vault rather than trying (and failing) to create it again.
        let second = unlock(&conn, &get_or_create_local_secret_at(&path).unwrap());
        assert!(second.is_ok());

        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn migrate_to_new_secret_reencrypts_every_secret_and_retires_the_old_password() {
        use crate::models::identity::{AuthMethod, IdentityInput};
        use crate::models::ssh_key::GenerateKeyInput;

        let conn = test_conn();
        crate::data::init_schema(&conn).unwrap();
        let old_key = create(&conn, LEGACY_PUBLIC_PASSWORD).unwrap();

        let identity = crate::data::identities::create(
            &conn,
            &old_key,
            IdentityInput {
                label: "test".into(),
                username: "root".into(),
                auth_method: AuthMethod::Password,
                ssh_key_id: None,
                password: Some("hunter2".into()),
            },
        )
        .unwrap();
        let key = crate::data::ssh_keys::generate(
            &conn,
            &old_key,
            GenerateKeyInput { label: "test-key".into() },
        )
        .unwrap();

        let new_key = migrate_to_new_secret(&conn, &old_key, "brand-new-secret").unwrap();

        // The legacy password must no longer work - that's the whole point.
        assert!(matches!(
            unlock(&conn, LEGACY_PUBLIC_PASSWORD),
            Err(AppError::InvalidPassword)
        ));
        assert!(unlock(&conn, "brand-new-secret").is_ok());

        // Every secret must still decrypt correctly, just under the new key.
        let (_, password) =
            crate::data::identities::get_with_decrypted_password(&conn, &new_key, identity.id)
                .unwrap();
        assert_eq!(password.as_deref(), Some("hunter2"));

        let (pem, _) =
            crate::data::ssh_keys::get_decrypted_private_key(&conn, &new_key, key.id).unwrap();
        assert!(pem.contains("BEGIN OPENSSH PRIVATE KEY"));

        // And decrypting with the retired key must now fail (proves the
        // ciphertext was actually re-encrypted, not just re-labeled).
        assert!(
            crate::data::ssh_keys::get_decrypted_private_key(&conn, &old_key, key.id).is_err()
        );
    }
}
