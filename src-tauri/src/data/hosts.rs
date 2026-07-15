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
        jump_host_id: row.get(6)?,
        color: row.get(7)?,
        notes: row.get(8)?,
        sort_order: row.get(9)?,
        last_connected_at: row.get(10)?,
    })
}

const SELECT_COLUMNS: &str = "id, group_id, label, hostname, port, identity_id, jump_host_id, color, notes, sort_order, last_connected_at";

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

pub fn create(conn: &Connection, input: HostInput) -> AppResult<Host> {
    let id = Uuid::new_v4();
    conn.execute(
        "INSERT INTO hosts (id, group_id, label, hostname, port, identity_id, jump_host_id, color, notes, sort_order)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        rusqlite::params![
            &id,
            &input.group_id,
            &input.label,
            &input.hostname,
            input.port,
            &input.identity_id,
            &input.jump_host_id,
            &input.color,
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
        jump_host_id: input.jump_host_id,
        color: input.color,
        notes: input.notes,
        sort_order: input.sort_order,
        last_connected_at: None,
    })
}

pub fn update(conn: &Connection, id: Uuid, input: HostInput) -> AppResult<Host> {
    let changed = conn.execute(
        "UPDATE hosts SET group_id = ?1, label = ?2, hostname = ?3, port = ?4, identity_id = ?5,
            jump_host_id = ?6, color = ?7, notes = ?8, sort_order = ?9 WHERE id = ?10",
        rusqlite::params![
            &input.group_id,
            &input.label,
            &input.hostname,
            input.port,
            &input.identity_id,
            &input.jump_host_id,
            &input.color,
            &input.notes,
            input.sort_order,
            &id,
        ],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound);
    }

    let last_connected_at: Option<String> = conn.query_row(
        "SELECT last_connected_at FROM hosts WHERE id = ?1",
        (&id,),
        |row| row.get(0),
    )?;

    Ok(Host {
        id,
        group_id: input.group_id,
        label: input.label,
        hostname: input.hostname,
        port: input.port,
        identity_id: input.identity_id,
        jump_host_id: input.jump_host_id,
        color: input.color,
        notes: input.notes,
        sort_order: input.sort_order,
        last_connected_at,
    })
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
            jump_host_id: None,
            color: None,
            notes: None,
            sort_order: 0,
        }
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
    fn delete_nonexistent_host_fails() {
        let conn = test_conn();
        let result = delete(&conn, Uuid::new_v4());
        assert!(matches!(result, Err(AppError::NotFound)));
    }

    #[test]
    fn jump_host_can_reference_another_host() {
        let conn = test_conn();
        let bastion = create(&conn, input()).unwrap();
        let internal = create(
            &conn,
            HostInput {
                label: "internal-1".into(),
                hostname: "10.0.1.5".into(),
                jump_host_id: Some(bastion.id),
                ..input()
            },
        )
        .unwrap();
        assert_eq!(internal.jump_host_id, Some(bastion.id));
    }
}
