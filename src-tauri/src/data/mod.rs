pub mod groups;
pub mod host_csv;
pub mod hosts;
pub mod identities;
pub mod snippets;
pub mod ssh_keys;

use rusqlite::Connection;

use crate::error::AppResult;

pub fn init_schema(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS groups (
            id TEXT PRIMARY KEY,
            parent_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
            name TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS ssh_keys (
            id TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            key_type TEXT NOT NULL,
            public_key TEXT NOT NULL,
            fingerprint TEXT NOT NULL,
            private_key_nonce BLOB NOT NULL,
            private_key_ciphertext BLOB NOT NULL,
            passphrase_nonce BLOB,
            passphrase_ciphertext BLOB,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS identities (
            id TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            username TEXT NOT NULL,
            auth_method TEXT NOT NULL,
            ssh_key_id TEXT REFERENCES ssh_keys(id) ON DELETE SET NULL,
            password_nonce BLOB,
            password_ciphertext BLOB
        );

        CREATE TABLE IF NOT EXISTS hosts (
            id TEXT PRIMARY KEY,
            group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
            label TEXT NOT NULL,
            hostname TEXT NOT NULL,
            port INTEGER NOT NULL DEFAULT 22,
            identity_id TEXT REFERENCES identities(id) ON DELETE SET NULL,
            jump_host_id TEXT REFERENCES hosts(id) ON DELETE SET NULL,
            color TEXT,
            notes TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            last_connected_at TEXT
        );

        CREATE TABLE IF NOT EXISTS snippets (
            id TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            body TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        ",
    )?;
    Ok(())
}
