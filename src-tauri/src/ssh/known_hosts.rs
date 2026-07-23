use rusqlite::{Connection, OptionalExtension, TransactionBehavior};

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
//
// `ssh::session::ClientHandler` calls this from its own short-lived
// connection to the same on-disk db file on every single SSH connect
// attempt - so unlike the rest of this codebase's `data/*.rs` modules,
// this SELECT-then-INSERT is NOT already serialized by AppState.db's
// Mutex, and can run concurrently with itself (e.g. Connect and SFTP
// clicked for the same brand-new host in quick succession, or Snippets'
// "run on hosts" first-connecting several never-before-seen hosts in
// parallel). `BEGIN IMMEDIATE` acquires SQLite's write lock up front, before
// the SELECT, so a second concurrent call for the same (hostname, port)
// blocks (via the caller's busy_timeout) until the first's transaction
// commits, then correctly observes the row it just inserted - rather than
// both seeing "not yet trusted" and either racing on the (hostname, port)
// primary key or silently double-trusting two different keys as if
// neither had ever been rejected.
pub fn verify_or_trust(
    conn: &mut Connection,
    hostname: &str,
    port: u16,
    fingerprint: &str,
) -> AppResult<HostKeyCheck> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;

    let existing: Option<String> = tx
        .query_row(
            "SELECT key_fingerprint FROM known_hosts WHERE hostname = ?1 AND port = ?2",
            (hostname, port),
            |row| row.get(0),
        )
        .optional()?;

    let result = match existing {
        Some(stored) if stored == fingerprint => Ok(HostKeyCheck::Matches),
        Some(stored) => Err(AppError::HostKeyMismatch {
            hostname: hostname.to_string(),
            expected: stored,
            got: fingerprint.to_string(),
        }),
        None => {
            tx.execute(
                "INSERT INTO known_hosts (hostname, port, key_fingerprint, accepted_at)
                 VALUES (?1, ?2, ?3, ?4)",
                (hostname, port, fingerprint, chrono::Utc::now().to_rfc3339()),
            )?;
            Ok(HostKeyCheck::TrustedNew)
        }
    };

    tx.commit()?;
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use uuid::Uuid;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        conn
    }

    #[test]
    fn first_connection_is_trusted() {
        let mut conn = test_conn();
        let result = verify_or_trust(&mut conn, "example.com", 22, "SHA256:abc").unwrap();
        assert!(matches!(result, HostKeyCheck::TrustedNew));
    }

    #[test]
    fn matching_fingerprint_on_later_connection_succeeds() {
        let mut conn = test_conn();
        verify_or_trust(&mut conn, "example.com", 22, "SHA256:abc").unwrap();
        let result = verify_or_trust(&mut conn, "example.com", 22, "SHA256:abc").unwrap();
        assert!(matches!(result, HostKeyCheck::Matches));
    }

    #[test]
    fn mismatched_fingerprint_is_rejected() {
        let mut conn = test_conn();
        verify_or_trust(&mut conn, "example.com", 22, "SHA256:abc").unwrap();
        let result = verify_or_trust(&mut conn, "example.com", 22, "SHA256:different");
        assert!(matches!(result, Err(AppError::HostKeyMismatch { .. })));
    }

    #[test]
    fn same_hostname_different_port_is_independent() {
        let mut conn = test_conn();
        verify_or_trust(&mut conn, "example.com", 22, "SHA256:abc").unwrap();
        let result = verify_or_trust(&mut conn, "example.com", 2222, "SHA256:different").unwrap();
        assert!(matches!(result, HostKeyCheck::TrustedNew));
    }

    // Regression test for a real race: two hosts being connected to for the
    // first time at once (e.g. Connect + SFTP clicked in quick succession
    // for the same brand-new host, or Snippets' "run on hosts" first-
    // connecting several never-before-seen hosts in parallel) each open
    // their own independent connection to the same on-disk db file (see
    // ssh::session::ClientHandler::check_server_key) - a plain
    // SELECT-then-INSERT with no transaction would let both connections
    // observe "not yet trusted" and both attempt to INSERT, racing on the
    // (hostname, port) primary key. Uses a real on-disk file (not
    // :memory:, which is private per-connection and so couldn't reproduce
    // a cross-connection race at all) and real OS threads so the race is
    // genuine.
    #[test]
    fn concurrent_first_connections_to_the_same_host_never_both_succeed_with_different_keys() {
        let dir = std::env::temp_dir().join(format!("connecthub-known-hosts-race-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("known_hosts.db");
        {
            let conn = Connection::open(&db_path).unwrap();
            init_schema(&conn).unwrap();
        }

        let barrier = Arc::new(std::sync::Barrier::new(2));
        let handles: Vec<_> = ["SHA256:aaa", "SHA256:bbb"]
            .into_iter()
            .map(|fingerprint| {
                let db_path = db_path.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    let mut conn = Connection::open(&db_path).unwrap();
                    conn.busy_timeout(std::time::Duration::from_secs(5)).unwrap();
                    barrier.wait();
                    verify_or_trust(&mut conn, "race.example.com", 22, fingerprint)
                })
            })
            .collect();
        let results: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();

        let trusted_new = results.iter().filter(|r| matches!(r, Ok(HostKeyCheck::TrustedNew))).count();
        let mismatches =
            results.iter().filter(|r| matches!(r, Err(AppError::HostKeyMismatch { .. }))).count();
        assert_eq!(
            trusted_new, 1,
            "exactly one of two concurrent first-time connections to the same host must win \
             and trust its key - both winning would mean the check-then-insert wasn't atomic"
        );
        assert_eq!(
            mismatches, 1,
            "the loser must see the winner's key and reject its own as a mismatch, never \
             silently succeed with a different key"
        );

        std::fs::remove_dir_all(&dir).ok();
    }
}
