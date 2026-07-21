use rusqlite::Connection;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::vpn_profile::{VpnProfile, VpnProfileInput};
use crate::vault::crypto;
use crate::vault::kdf::VaultKey;

fn row_to_profile(row: &rusqlite::Row) -> rusqlite::Result<VpnProfile> {
    let has_password: Option<Vec<u8>> = row.get(4)?;
    Ok(VpnProfile {
        id: row.get(0)?,
        label: row.get(1)?,
        config: row.get(2)?,
        auth_username: row.get(3)?,
        has_auth_password: has_password.is_some(),
        avoid_default_route: row.get(5)?,
        created_at: row.get(6)?,
    })
}

const SELECT_COLUMNS: &str = "id, label, config, auth_username, auth_password_ciphertext, avoid_default_route, created_at";

pub fn list(conn: &Connection) -> AppResult<Vec<VpnProfile>> {
    let mut stmt = conn.prepare(&format!("SELECT {SELECT_COLUMNS} FROM vpn_profiles ORDER BY label"))?;
    let rows = stmt.query_map((), row_to_profile)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn get(conn: &Connection, id: Uuid) -> AppResult<VpnProfile> {
    conn.query_row(
        &format!("SELECT {SELECT_COLUMNS} FROM vpn_profiles WHERE id = ?1"),
        (&id,),
        row_to_profile,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => AppError::NotFound,
        other => AppError::Db(other),
    })
}

// Internal-only: used by the VPN connect flow, never exposed as a Tauri
// command. Returns the profile plus its decrypted auth-user-pass
// credentials, if both a username and password are stored (profiles that
// only carry inline certs/keys have neither).
pub fn get_with_decrypted_auth(
    conn: &Connection,
    key: &VaultKey,
    id: Uuid,
) -> AppResult<(VpnProfile, Option<(String, String)>)> {
    let profile = get(conn, id)?;

    let (nonce, ciphertext): (Option<Vec<u8>>, Option<Vec<u8>>) = conn.query_row(
        "SELECT auth_password_nonce, auth_password_ciphertext FROM vpn_profiles WHERE id = ?1",
        (&id,),
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;

    let auth = match (&profile.auth_username, nonce, ciphertext) {
        (Some(username), Some(nonce), Some(ciphertext)) => {
            let plaintext = crypto::decrypt(key, &nonce, &ciphertext)?;
            let password = String::from_utf8(plaintext)
                .map_err(|_| AppError::Crypto("stored password is not valid UTF-8".into()))?;
            Some((username.clone(), password))
        }
        _ => None,
    };

    Ok((profile, auth))
}

// OpenVPN's `--script-security 0` (unconditionally forced at connect time,
// see vpn::mod's helper invocation) blocks every scripting hook a config can
// define - `up`/`down`/`route-up`/`tls-verify`/`client-connect`/etc. - except
// one: `plugin <module> [init-string]` loads a shared object into the
// running (root-owned) process and is explicitly documented by OpenVPN as
// not subject to script-security. Since that's the one directive the
// script-security boundary doesn't cover, reject it outright here rather
// than let an uploaded/pasted .ovpn achieve root code execution the moment
// someone clicks Connect.
fn validate_config(config: &str) -> AppResult<()> {
    for line in config.lines() {
        let trimmed = line.trim_start();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with(';') {
            continue;
        }
        let directive = trimmed.split_whitespace().next().unwrap_or("");
        if directive.eq_ignore_ascii_case("plugin") {
            return Err(AppError::Vpn(
                "this OpenVPN config uses a 'plugin' directive, which loads native code into \
                 the connection process and isn't restricted by script-security - refusing to \
                 save it for safety. Remove the 'plugin' line if you trust this config, or use \
                 a config without it."
                    .into(),
            ));
        }
    }
    Ok(())
}

pub fn create(conn: &Connection, key: &VaultKey, input: VpnProfileInput) -> AppResult<VpnProfile> {
    validate_config(&input.config)?;
    let id = Uuid::new_v4();
    let created_at = chrono::Utc::now().to_rfc3339();
    let password = input.auth_password.filter(|p| !p.is_empty());
    let (nonce, ciphertext): (Option<Vec<u8>>, Option<Vec<u8>>) = match &password {
        Some(p) => {
            let enc = crypto::encrypt(key, p.as_bytes())?;
            (Some(enc.nonce.to_vec()), Some(enc.ciphertext))
        }
        None => (None, None),
    };

    conn.execute(
        "INSERT INTO vpn_profiles (id, label, config, auth_username, auth_password_nonce, auth_password_ciphertext, avoid_default_route, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            &id,
            &input.label,
            &input.config,
            &input.auth_username,
            nonce,
            ciphertext,
            input.avoid_default_route,
            &created_at,
        ],
    )?;

    Ok(VpnProfile {
        id,
        label: input.label,
        config: input.config,
        auth_username: input.auth_username,
        has_auth_password: password.is_some(),
        avoid_default_route: input.avoid_default_route,
        created_at,
    })
}

// `input.auth_password`: None keeps the existing stored password unchanged,
// Some("") clears it, Some(p) replaces it - see VpnProfileInput's docs.
pub fn update(
    conn: &Connection,
    key: &VaultKey,
    id: Uuid,
    input: VpnProfileInput,
) -> AppResult<VpnProfile> {
    validate_config(&input.config)?;
    let created_at: String = conn
        .query_row(
            "SELECT created_at FROM vpn_profiles WHERE id = ?1",
            (&id,),
            |row| row.get(0),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound,
            other => AppError::Db(other),
        })?;

    let has_auth_password = match input.auth_password {
        Some(ref p) if !p.is_empty() => {
            let enc = crypto::encrypt(key, p.as_bytes())?;
            conn.execute(
                "UPDATE vpn_profiles SET label = ?1, config = ?2, auth_username = ?3,
                    auth_password_nonce = ?4, auth_password_ciphertext = ?5, avoid_default_route = ?6 WHERE id = ?7",
                rusqlite::params![
                    &input.label,
                    &input.config,
                    &input.auth_username,
                    &enc.nonce[..],
                    &enc.ciphertext[..],
                    input.avoid_default_route,
                    &id,
                ],
            )?;
            true
        }
        Some(_) => {
            // empty string: clear the stored password
            conn.execute(
                "UPDATE vpn_profiles SET label = ?1, config = ?2, auth_username = ?3,
                    auth_password_nonce = NULL, auth_password_ciphertext = NULL, avoid_default_route = ?4 WHERE id = ?5",
                rusqlite::params![&input.label, &input.config, &input.auth_username, input.avoid_default_route, &id],
            )?;
            false
        }
        None => {
            conn.execute(
                "UPDATE vpn_profiles SET label = ?1, config = ?2, auth_username = ?3, avoid_default_route = ?4 WHERE id = ?5",
                rusqlite::params![&input.label, &input.config, &input.auth_username, input.avoid_default_route, &id],
            )?;
            let existing: Option<Vec<u8>> = conn.query_row(
                "SELECT auth_password_ciphertext FROM vpn_profiles WHERE id = ?1",
                (&id,),
                |row| row.get(0),
            )?;
            existing.is_some()
        }
    };

    Ok(VpnProfile {
        id,
        label: input.label,
        config: input.config,
        auth_username: input.auth_username,
        has_auth_password,
        avoid_default_route: input.avoid_default_route,
        created_at,
    })
}

// Clears `vpn_profile_id` on any host that referenced this profile before
// deleting it, since `hosts.vpn_profile_id` isn't declared with a live FK
// on databases migrated from before this column existed (see data::mod's
// `add_column_if_missing`) - this keeps behavior identical on fresh and
// migrated databases instead of relying on ON DELETE SET NULL.
pub fn delete(conn: &Connection, id: Uuid) -> AppResult<()> {
    conn.execute(
        "UPDATE hosts SET vpn_profile_id = NULL WHERE vpn_profile_id = ?1",
        (&id,),
    )?;
    let changed = conn.execute("DELETE FROM vpn_profiles WHERE id = ?1", (&id,))?;
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

    fn input(auth: Option<(&str, &str)>) -> VpnProfileInput {
        VpnProfileInput {
            label: "office vpn".into(),
            config: "client\nremote vpn.example.com 1194\n".into(),
            auth_username: auth.map(|(u, _)| u.to_string()),
            auth_password: auth.map(|(_, p)| p.to_string()),
            avoid_default_route: true,
        }
    }

    #[test]
    fn create_defaults_avoid_default_route_as_given_and_update_can_flip_it() {
        let conn = test_conn();
        let key = test_key();
        let created = create(&conn, &key, input(None)).unwrap();
        assert!(created.avoid_default_route);

        let updated = update(
            &conn,
            &key,
            created.id,
            VpnProfileInput { avoid_default_route: false, ..input(None) },
        )
        .unwrap();
        assert!(!updated.avoid_default_route);

        let refetched = get(&conn, created.id).unwrap();
        assert!(!refetched.avoid_default_route);
    }

    #[test]
    fn create_without_auth_reports_has_password_false() {
        let conn = test_conn();
        let key = test_key();
        let created = create(&conn, &key, input(None)).unwrap();
        assert!(!created.has_auth_password);
        assert_eq!(created.auth_username, None);
    }

    #[test]
    fn create_with_auth_reports_has_password_true_and_encrypts_it() {
        let conn = test_conn();
        let key = test_key();
        let created = create(&conn, &key, input(Some(("alice", "s3cret")))).unwrap();
        assert!(created.has_auth_password);
        assert_eq!(created.auth_username.as_deref(), Some("alice"));

        let ciphertext: Vec<u8> = conn
            .query_row(
                "SELECT auth_password_ciphertext FROM vpn_profiles WHERE id = ?1",
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
        let created = create(&conn, &key, input(Some(("alice", "s3cret")))).unwrap();

        let updated = update(
            &conn,
            &key,
            created.id,
            VpnProfileInput {
                label: "renamed".into(),
                ..input(None)
            },
        )
        .unwrap();

        assert_eq!(updated.label, "renamed");
        assert!(updated.has_auth_password, "password should survive an update that doesn't mention it");
    }

    #[test]
    fn update_with_empty_password_clears_it() {
        let conn = test_conn();
        let key = test_key();
        let created = create(&conn, &key, input(Some(("alice", "s3cret")))).unwrap();

        let updated = update(&conn, &key, created.id, input(Some(("alice", "")))).unwrap();
        assert!(!updated.has_auth_password);
    }

    #[test]
    fn get_with_decrypted_auth_roundtrips_the_plaintext() {
        let conn = test_conn();
        let key = test_key();
        let created = create(&conn, &key, input(Some(("alice", "s3cret")))).unwrap();

        let (profile, auth) = get_with_decrypted_auth(&conn, &key, created.id).unwrap();
        assert_eq!(profile.id, created.id);
        assert_eq!(auth, Some(("alice".to_string(), "s3cret".to_string())));
    }

    #[test]
    fn get_with_decrypted_auth_is_none_when_no_auth_set() {
        let conn = test_conn();
        let key = test_key();
        let created = create(&conn, &key, input(None)).unwrap();

        let (_, auth) = get_with_decrypted_auth(&conn, &key, created.id).unwrap();
        assert_eq!(auth, None);
    }

    #[test]
    fn update_nonexistent_profile_fails() {
        let conn = test_conn();
        let key = test_key();
        let result = update(&conn, &key, Uuid::new_v4(), input(None));
        assert!(matches!(result, Err(AppError::NotFound)));
    }

    #[test]
    fn delete_clears_referencing_host_before_removing_profile() {
        use crate::data::hosts;
        use crate::models::host::HostInput;

        let conn = test_conn();
        let key = test_key();
        let profile = create(&conn, &key, input(None)).unwrap();
        let host = hosts::create(
            &conn,
            HostInput {
                group_id: None,
                label: "private-host".into(),
                hostname: "10.0.5.5".into(),
                port: 22,
                identity_id: None,
                jump_host_id: None,
                vpn_profile_id: Some(profile.id),
                color: None,
                notes: None,
                sort_order: 0,
            },
        )
        .unwrap();

        delete(&conn, profile.id).unwrap();

        let refreshed = hosts::get(&conn, host.id).unwrap();
        assert_eq!(refreshed.vpn_profile_id, None);
        assert!(matches!(get(&conn, profile.id), Err(AppError::NotFound)));
    }

    #[test]
    fn delete_nonexistent_profile_fails() {
        let conn = test_conn();
        let result = delete(&conn, Uuid::new_v4());
        assert!(matches!(result, Err(AppError::NotFound)));
    }

    #[test]
    fn create_rejects_a_plugin_directive() {
        let conn = test_conn();
        let key = test_key();
        let mut bad = input(None);
        bad.config = "client\nplugin /usr/lib/openvpn/evil.so\nremote vpn.example.com 1194\n".into();
        let result = create(&conn, &key, bad);
        assert!(matches!(result, Err(AppError::Vpn(_))));
    }

    #[test]
    fn create_rejects_a_plugin_directive_regardless_of_case_or_leading_whitespace() {
        let conn = test_conn();
        let key = test_key();
        let mut bad = input(None);
        bad.config = "client\n   Plugin /usr/lib/openvpn/evil.so\n".into();
        let result = create(&conn, &key, bad);
        assert!(matches!(result, Err(AppError::Vpn(_))));
    }

    #[test]
    fn create_allows_a_commented_out_plugin_line() {
        let conn = test_conn();
        let key = test_key();
        let mut ok = input(None);
        ok.config = "client\n# plugin /usr/lib/openvpn/evil.so\nremote vpn.example.com 1194\n".into();
        assert!(create(&conn, &key, ok).is_ok());
    }

    #[test]
    fn update_rejects_a_plugin_directive() {
        let conn = test_conn();
        let key = test_key();
        let created = create(&conn, &key, input(None)).unwrap();
        let mut bad = input(None);
        bad.config = "plugin /tmp/evil.so\n".into();
        let result = update(&conn, &key, created.id, bad);
        assert!(matches!(result, Err(AppError::Vpn(_))));
    }
}
