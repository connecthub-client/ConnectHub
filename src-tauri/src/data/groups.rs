use rusqlite::Connection;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::group::{Group, GroupInput};

fn row_to_group(row: &rusqlite::Row) -> rusqlite::Result<Group> {
    Ok(Group {
        id: row.get(0)?,
        parent_id: row.get(1)?,
        name: row.get(2)?,
        sort_order: row.get(3)?,
    })
}

pub fn list(conn: &Connection) -> AppResult<Vec<Group>> {
    let mut stmt =
        conn.prepare("SELECT id, parent_id, name, sort_order FROM groups ORDER BY sort_order")?;
    let rows = stmt.query_map((), row_to_group)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn create(conn: &Connection, input: GroupInput) -> AppResult<Group> {
    let id = Uuid::new_v4();
    conn.execute(
        "INSERT INTO groups (id, parent_id, name, sort_order) VALUES (?1, ?2, ?3, ?4)",
        (&id, &input.parent_id, &input.name, input.sort_order),
    )?;
    Ok(Group {
        id,
        parent_id: input.parent_id,
        name: input.name,
        sort_order: input.sort_order,
    })
}

pub fn update(conn: &Connection, id: Uuid, input: GroupInput) -> AppResult<Group> {
    let changed = conn.execute(
        "UPDATE groups SET parent_id = ?1, name = ?2, sort_order = ?3 WHERE id = ?4",
        (&input.parent_id, &input.name, input.sort_order, &id),
    )?;
    if changed == 0 {
        return Err(AppError::NotFound);
    }
    Ok(Group {
        id,
        parent_id: input.parent_id,
        name: input.name,
        sort_order: input.sort_order,
    })
}

pub fn delete(conn: &Connection, id: Uuid) -> AppResult<()> {
    let changed = conn.execute("DELETE FROM groups WHERE id = ?1", (&id,))?;
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

    fn input(name: &str, parent_id: Option<Uuid>) -> GroupInput {
        GroupInput {
            parent_id,
            name: name.into(),
            sort_order: 0,
        }
    }

    #[test]
    fn nested_groups_roundtrip() {
        let conn = test_conn();
        let parent = create(&conn, input("Production", None)).unwrap();
        let child = create(&conn, input("US-East", Some(parent.id))).unwrap();

        let listed = list(&conn).unwrap();
        assert_eq!(listed.len(), 2);
        assert_eq!(
            listed.iter().find(|g| g.id == child.id).unwrap().parent_id,
            Some(parent.id)
        );
    }

    #[test]
    fn deleting_parent_orphans_child_instead_of_failing() {
        let conn = test_conn();
        let parent = create(&conn, input("Production", None)).unwrap();
        let child = create(&conn, input("US-East", Some(parent.id))).unwrap();

        delete(&conn, parent.id).unwrap();

        let listed = list(&conn).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, child.id);
        assert_eq!(listed[0].parent_id, None);
    }

    #[test]
    fn update_nonexistent_group_fails() {
        let conn = test_conn();
        let result = update(&conn, Uuid::new_v4(), input("X", None));
        assert!(matches!(result, Err(AppError::NotFound)));
    }
}
