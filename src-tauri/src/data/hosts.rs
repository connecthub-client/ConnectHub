use rusqlite::Connection;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::host::{Host, HostInput};

fn row_to_host(row: &rusqlite::Row) -> rusqlite::Result<Host> {
    Ok(Host {
        id: row.get(0)?,
        group_id: row.get(1)?,
        label: row.get(2)?,
        hostname: row.get(3)?,
        port: row.get(4)?,
        identity_id: row.get(5)?,
        vpn_profile_id: row.get(6)?,
        color: row.get(7)?,
        icon: row.get(8)?,
        notes: row.get(9)?,
        sort_order: row.get(10)?,
        last_connected_at: row.get(11)?,
        is_favorite: row.get(12)?,
    })
}

const SELECT_COLUMNS: &str = "id, group_id, label, hostname, port, identity_id, vpn_profile_id, color, icon, notes, sort_order, last_connected_at, is_favorite";

pub fn get(conn: &Connection, id: Uuid) -> AppResult<Host> {
    conn.query_row(
        &format!("SELECT {SELECT_COLUMNS} FROM hosts WHERE id = ?1"),
        (&id,),
        row_to_host,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => AppError::NotFound,
        other => AppError::Db(other),
    })
}

pub fn list(conn: &Connection) -> AppResult<Vec<Host>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SELECT_COLUMNS} FROM hosts ORDER BY sort_order"
    ))?;
    let rows = stmt.query_map((), row_to_host)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

// Every host that shares a given VPN profile - used at connect time to
// figure out which specific hosts should get an explicit route through
// that profile's tunnel once it's up (see vpn::connect).
pub fn list_by_vpn_profile(conn: &Connection, vpn_profile_id: Uuid) -> AppResult<Vec<Host>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SELECT_COLUMNS} FROM hosts WHERE vpn_profile_id = ?1 ORDER BY sort_order"
    ))?;
    let rows = stmt.query_map((&vpn_profile_id,), row_to_host)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn create(conn: &Connection, input: HostInput) -> AppResult<Host> {
    let id = Uuid::new_v4();
    conn.execute(
        "INSERT INTO hosts (id, group_id, label, hostname, port, identity_id, vpn_profile_id, color, icon, notes, sort_order)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        rusqlite::params![
            &id,
            &input.group_id,
            &input.label,
            &input.hostname,
            input.port,
            &input.identity_id,
            &input.vpn_profile_id,
            &input.color,
            &input.icon,
            &input.notes,
            input.sort_order,
        ],
    )?;

    Ok(Host {
        id,
        group_id: input.group_id,
        label: input.label,
        hostname: input.hostname,
        port: input.port,
        identity_id: input.identity_id,
        vpn_profile_id: input.vpn_profile_id,
        color: input.color,
        icon: input.icon,
        notes: input.notes,
        sort_order: input.sort_order,
        last_connected_at: None,
        is_favorite: false,
    })
}

pub fn update(conn: &Connection, id: Uuid, input: HostInput) -> AppResult<Host> {
    let changed = conn.execute(
        "UPDATE hosts SET group_id = ?1, label = ?2, hostname = ?3, port = ?4, identity_id = ?5,
            vpn_profile_id = ?6, color = ?7, icon = ?8, notes = ?9, sort_order = ?10 WHERE id = ?11",
        rusqlite::params![
            &input.group_id,
            &input.label,
            &input.hostname,
            input.port,
            &input.identity_id,
            &input.vpn_profile_id,
            &input.color,
            &input.icon,
            &input.notes,
            input.sort_order,
            &id,
        ],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound);
    }

    // Re-fetch rather than reconstruct by hand: `is_favorite` (and
    // `last_connected_at`) aren't part of `HostInput` - they're toggled
    // independently of the edit form - so the UPDATE above never touches
    // them, and the only way to return their current value is to read the
    // row back.
    get(conn, id)
}

// Toggles favorite status directly, independent of the full edit form -
// mirrors `touch_last_connected`'s single-column-update shape.
pub fn set_favorite(conn: &Connection, id: Uuid, favorite: bool) -> AppResult<Host> {
    let changed = conn.execute(
        "UPDATE hosts SET is_favorite = ?1 WHERE id = ?2",
        rusqlite::params![favorite, &id],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound);
    }
    get(conn, id)
}

pub fn touch_last_connected(conn: &Connection, id: Uuid) -> AppResult<()> {
    conn.execute(
        "UPDATE hosts SET last_connected_at = ?1 WHERE id = ?2",
        rusqlite::params![chrono::Utc::now().to_rfc3339(), &id],
    )?;
    Ok(())
}

pub fn delete(conn: &Connection, id: Uuid) -> AppResult<()> {
    let changed = conn.execute("DELETE FROM hosts WHERE id = ?1", (&id,))?;
    if changed == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::data::init_schema(&conn).unwrap();
        conn
    }

    fn input() -> HostInput {
        HostInput {
            group_id: None,
            label: "prod-1".into(),
            hostname: "10.0.0.5".into(),
            port: 22,
            identity_id: None,
            vpn_profile_id: None,
            color: None,
            icon: None,
            notes: None,
            sort_order: 0,
        }
    }

    #[test]
    fn create_and_update_roundtrip_the_icon_field() {
        let conn = test_conn();
        let created = create(&conn, HostInput { icon: Some("server".into()), ..input() }).unwrap();
        assert_eq!(created.icon, Some("server".into()));

        let updated =
            update(&conn, created.id, HostInput { icon: Some("database".into()), ..input() }).unwrap();
        assert_eq!(updated.icon, Some("database".into()));

        let cleared = update(&conn, created.id, HostInput { icon: None, ..input() }).unwrap();
        assert_eq!(cleared.icon, None);
    }

    #[test]
    fn create_then_list_roundtrips() {
        let conn = test_conn();
        let created = create(&conn, input()).unwrap();
        let listed = list(&conn).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, created.id);
        assert_eq!(listed[0].hostname, "10.0.0.5");
        assert_eq!(listed[0].last_connected_at, None);
    }

    #[test]
    fn update_changes_fields() {
        let conn = test_conn();
        let created = create(&conn, input()).unwrap();
        let updated = update(
            &conn,
            created.id,
            HostInput {
                label: "prod-1-renamed".into(),
                port: 2222,
                ..input()
            },
        )
        .unwrap();
        assert_eq!(updated.label, "prod-1-renamed");
        assert_eq!(updated.port, 2222);
    }

    #[test]
    fn touch_last_connected_sets_timestamp() {
        let conn = test_conn();
        let created = create(&conn, input()).unwrap();
        assert_eq!(created.last_connected_at, None);

        touch_last_connected(&conn, created.id).unwrap();

        let refreshed = get(&conn, created.id).unwrap();
        assert!(refreshed.last_connected_at.is_some());
    }

    #[test]
    fn create_defaults_is_favorite_to_false() {
        let conn = test_conn();
        let created = create(&conn, input()).unwrap();
        assert!(!created.is_favorite);
    }

    #[test]
    fn set_favorite_toggles_and_persists() {
        let conn = test_conn();
        let created = create(&conn, input()).unwrap();

        let favorited = set_favorite(&conn, created.id, true).unwrap();
        assert!(favorited.is_favorite);
        assert!(get(&conn, created.id).unwrap().is_favorite);

        let unfavorited = set_favorite(&conn, created.id, false).unwrap();
        assert!(!unfavorited.is_favorite);
    }

    #[test]
    fn set_favorite_nonexistent_host_fails() {
        let conn = test_conn();
        let result = set_favorite(&conn, Uuid::new_v4(), true);
        assert!(matches!(result, Err(AppError::NotFound)));
    }

    #[test]
    fn update_does_not_reset_is_favorite() {
        let conn = test_conn();
        let created = create(&conn, input()).unwrap();
        set_favorite(&conn, created.id, true).unwrap();

        let updated = update(&conn, created.id, HostInput { label: "renamed".into(), ..input() }).unwrap();
        assert!(updated.is_favorite);
    }

    #[test]
    fn delete_nonexistent_host_fails() {
        let conn = test_conn();
        let result = delete(&conn, Uuid::new_v4());
        assert!(matches!(result, Err(AppError::NotFound)));
    }

    #[test]
    fn list_by_vpn_profile_returns_only_hosts_sharing_that_profile() {
        use crate::data::vpn_profiles;
        use crate::models::vpn_profile::VpnProfileInput;
        use crate::vault::kdf::test_key;

        let conn = test_conn();
        let key = test_key();
        let vpn_input = |label: &str| VpnProfileInput {
            label: label.into(),
            config: "client\n".into(),
            auth_username: None,
            auth_password: None,
            avoid_default_route: true,
        };
        let profile_id = vpn_profiles::create(&conn, &key, vpn_input("profile-a")).unwrap().id;
        let other_profile_id = vpn_profiles::create(&conn, &key, vpn_input("profile-b")).unwrap().id;

        // Three hosts on the same profile - not just two - since a query
        // that happens to work for exactly 2 (e.g. an accidental LIMIT, or
        // logic that only ever looks at the first match) wouldn't be caught
        // by a 2-host fixture. This directly covers the "more than 2 hosts
        // sharing one VPN profile" scenario the routing/on-demand-route
        // logic elsewhere (vpn::add_host_routes/ensure_host_route) needs to
        // handle for any number of hosts, not just a pair.
        let matching_a = create(
            &conn,
            HostInput { label: "a".into(), vpn_profile_id: Some(profile_id), ..input() },
        )
        .unwrap();
        let matching_b = create(
            &conn,
            HostInput { label: "b".into(), vpn_profile_id: Some(profile_id), ..input() },
        )
        .unwrap();
        let matching_c = create(
            &conn,
            HostInput { label: "c".into(), vpn_profile_id: Some(profile_id), ..input() },
        )
        .unwrap();
        create(
            &conn,
            HostInput { label: "other-profile".into(), vpn_profile_id: Some(other_profile_id), ..input() },
        )
        .unwrap();
        create(&conn, HostInput { label: "no-profile".into(), ..input() }).unwrap();

        let matched = list_by_vpn_profile(&conn, profile_id).unwrap();
        let matched_ids: Vec<Uuid> = matched.iter().map(|h| h.id).collect();
        assert_eq!(matched.len(), 3);
        assert!(matched_ids.contains(&matching_a.id));
        assert!(matched_ids.contains(&matching_b.id));
        assert!(matched_ids.contains(&matching_c.id));
    }
}
