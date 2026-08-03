pub mod google_auth;
pub mod groups;
pub mod host_csv;
pub mod hosts;
pub mod identities;
pub mod snippets;
pub mod ssh_keys;
pub mod tags;
pub mod vpn_profiles;
pub mod workspaces;

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

        CREATE TABLE IF NOT EXISTS vpn_profiles (
            id TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            config TEXT NOT NULL,
            auth_username TEXT,
            auth_password_nonce BLOB,
            auth_password_ciphertext BLOB,
            avoid_default_route INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS hosts (
            id TEXT PRIMARY KEY,
            group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
            label TEXT NOT NULL,
            hostname TEXT NOT NULL,
            port INTEGER NOT NULL DEFAULT 22,
            identity_id TEXT REFERENCES identities(id) ON DELETE SET NULL,
            vpn_profile_id TEXT REFERENCES vpn_profiles(id) ON DELETE SET NULL,
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

        -- Both tables are wholly new (not columns bolted onto an existing
        -- table), so - unlike hosts.vpn_profile_id/is_favorite/icon below -
        -- CREATE TABLE IF NOT EXISTS alone is enough on both fresh and
        -- migrated installs; no add_column_if_missing backfill applies.
        CREATE TABLE IF NOT EXISTS tags (
            id TEXT PRIMARY KEY,
            label TEXT NOT NULL UNIQUE
        );

        CREATE TABLE IF NOT EXISTS host_tags (
            host_id TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
            tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
            PRIMARY KEY (host_id, tag_id)
        );

        -- A workspace is an on-demand, named snapshot of which tabs (and
        -- how many panes each) were open at save time - not an
        -- auto-restored session. workspace_tabs.host_id cascades on host
        -- delete (unlike hosts.group_id's ON DELETE SET NULL) since a tab
        -- with no host to open doesn't mean anything - the whole row, not
        -- just the reference, should go.
        CREATE TABLE IF NOT EXISTS workspaces (
            id TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS workspace_tabs (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
            host_id TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
            kind TEXT NOT NULL,
            pane_count INTEGER NOT NULL DEFAULT 1,
            sort_order INTEGER NOT NULL DEFAULT 0
        );

        -- Bundled into the vault backup itself (not device-specific) so a
        -- restore on a new device can keep syncing without a fresh login.
        CREATE TABLE IF NOT EXISTS google_auth (
            id INTEGER PRIMARY KEY CHECK (id = 0),
            account_email TEXT,
            refresh_token_nonce BLOB NOT NULL,
            refresh_token_ciphertext BLOB NOT NULL
        );
        ",
    )?;

    // `hosts.vpn_profile_id` was added after some installs already created
    // their `hosts` table without it - `CREATE TABLE IF NOT EXISTS` above is
    // a no-op for those, so backfill the column by hand. No REFERENCES
    // clause here (unlike the fresh-install column above): rather than lean
    // on SQLite's ADD COLUMN + foreign key semantics, `vpn_profiles::delete`
    // clears any referencing `hosts.vpn_profile_id` rows itself before
    // deleting, so behavior is identical on fresh and migrated databases.
    add_column_if_missing(conn, "hosts", "vpn_profile_id", "TEXT")?;

    // Same backfill for installs whose `vpn_profiles` table predates this
    // column - default to 1 (split-tunnel: don't take over the default
    // route) since that's what lets multiple profiles for different
    // projects stay connected at once without one breaking the others'
    // connectivity, which existing profiles just as much as new ones.
    add_column_if_missing(
        conn,
        "vpn_profiles",
        "avoid_default_route",
        "INTEGER NOT NULL DEFAULT 1",
    )?;

    // Same backfill pattern for hosts predating the favorites feature.
    add_column_if_missing(conn, "hosts", "is_favorite", "INTEGER NOT NULL DEFAULT 0")?;

    // Same backfill pattern for hosts predating the icon picker.
    add_column_if_missing(conn, "hosts", "icon", "TEXT")?;

    Ok(())
}

fn add_column_if_missing(
    conn: &Connection,
    table: &str,
    column: &str,
    decl: &str,
) -> AppResult<()> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let mut exists = false;
    for name in stmt.query_map((), |row| row.get::<_, String>(1))? {
        if name? == column {
            exists = true;
            break;
        }
    }
    drop(stmt);

    if !exists {
        conn.execute(&format!("ALTER TABLE {table} ADD COLUMN {column} {decl}"), ())?;
    }
    Ok(())
}
