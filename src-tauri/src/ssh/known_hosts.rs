use rusqlite::{Connection, OptionalExtension};

use crate::error::{AppError, AppResult};

pub fn init_schema(conn: &Connection) -> AppResult<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS known_hosts (
            hostname TEXT NOT NULL,
            port INTEGER NOT NULL,
            key_fingerprint TEXT NOT NULL,
            accepted_at TEXT NOT NULL,
            PRIMARY KEY (hostname, port)
        )",
        (),
    )?;
    Ok(())
}

pub enum HostKeyCheck {
    TrustedNew,
    Matches,
}

// Trust-on-first-use: a host's key is auto-trusted the first time we see it
// and pinned from then on. Any later mismatch is refused outright rather than
// silently re-trusted, since that's the actual MITM-prevention property TOFU
// is supposed to give you.
pub fn verify_or_trust(
    conn: &Connection,
    hostname: &str,
    port: u16,
    fingerprint: &str,
) -> AppResult<HostKeyCheck> {
    let existing: Option<String> = conn
        .query_row(
            "SELECT key_fingerprint FROM known_hosts WHERE hostname = ?1 AND port = ?2",
            (hostname, port),
            |row| row.get(0),
        )
        .optional()?;

    match existing {
        Some(stored) if stored == fingerprint => Ok(HostKeyCheck::Matches),
        Some(stored) => Err(AppError::HostKeyMismatch {
            hostname: hostname.to_string(),
            expected: stored,
            got: fingerprint.to_string(),
        }),
        None => {
            conn.execute(
                "INSERT INTO known_hosts (hostname, port, key_fingerprint, accepted_at)
                 VALUES (?1, ?2, ?3, ?4)",
                (hostname, port, fingerprint, chrono::Utc::now().to_rfc3339()),
            )?;
            Ok(HostKeyCheck::TrustedNew)
        }
    }
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
    fn first_connection_is_trusted() {
        let conn = test_conn();
        let result = verify_or_trust(&conn, "example.com", 22, "SHA256:abc").unwrap();
        assert!(matches!(result, HostKeyCheck::TrustedNew));
    }

    #[test]
    fn matching_fingerprint_on_later_connection_succeeds() {
        let conn = test_conn();
        verify_or_trust(&conn, "example.com", 22, "SHA256:abc").unwrap();
        let result = verify_or_trust(&conn, "example.com", 22, "SHA256:abc").unwrap();
        assert!(matches!(result, HostKeyCheck::Matches));
    }

    #[test]
    fn mismatched_fingerprint_is_rejected() {
        let conn = test_conn();
        verify_or_trust(&conn, "example.com", 22, "SHA256:abc").unwrap();
        let result = verify_or_trust(&conn, "example.com", 22, "SHA256:different");
        assert!(matches!(result, Err(AppError::HostKeyMismatch { .. })));
    }

    #[test]
    fn same_hostname_different_port_is_independent() {
        let conn = test_conn();
        verify_or_trust(&conn, "example.com", 22, "SHA256:abc").unwrap();
        let result = verify_or_trust(&conn, "example.com", 2222, "SHA256:different").unwrap();
        assert!(matches!(result, HostKeyCheck::TrustedNew));
    }
}
