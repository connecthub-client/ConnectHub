use rusqlite::Connection;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::snippet::{Snippet, SnippetInput};

fn row_to_snippet(row: &rusqlite::Row) -> rusqlite::Result<Snippet> {
    Ok(Snippet {
        id: row.get(0)?,
        label: row.get(1)?,
        body: row.get(2)?,
    })
}

pub fn list(conn: &Connection) -> AppResult<Vec<Snippet>> {
    let mut stmt =
        conn.prepare("SELECT id, label, body FROM snippets ORDER BY label")?;
    let rows = stmt.query_map((), row_to_snippet)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn create(conn: &Connection, input: SnippetInput) -> AppResult<Snippet> {
    let id = Uuid::new_v4();
    let created_at = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO snippets (id, label, body, created_at) VALUES (?1, ?2, ?3, ?4)",
        (&id, &input.label, &input.body, &created_at),
    )?;
    Ok(Snippet {
        id,
        label: input.label,
        body: input.body,
    })
}

pub fn update(conn: &Connection, id: Uuid, input: SnippetInput) -> AppResult<Snippet> {
    let changed = conn.execute(
        "UPDATE snippets SET label = ?1, body = ?2 WHERE id = ?3",
        (&input.label, &input.body, &id),
    )?;
    if changed == 0 {
        return Err(AppError::NotFound);
    }
    Ok(Snippet {
        id,
        label: input.label,
        body: input.body,
    })
}

pub fn delete(conn: &Connection, id: Uuid) -> AppResult<()> {
    let changed = conn.execute("DELETE FROM snippets WHERE id = ?1", (&id,))?;
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

    fn input(label: &str, body: &str) -> SnippetInput {
        SnippetInput {
            label: label.into(),
            body: body.into(),
        }
    }

    #[test]
    fn create_then_list_roundtrips() {
        let conn = test_conn();
        let created = create(&conn, input("disk usage", "df -h")).unwrap();
        let listed = list(&conn).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, created.id);
        assert_eq!(listed[0].body, "df -h");
    }

    #[test]
    fn update_changes_fields() {
        let conn = test_conn();
        let created = create(&conn, input("disk usage", "df -h")).unwrap();
        let updated = update(&conn, created.id, input("disk usage (all)", "df -ah")).unwrap();
        assert_eq!(updated.label, "disk usage (all)");
        assert_eq!(updated.body, "df -ah");
    }

    #[test]
    fn delete_nonexistent_snippet_fails() {
        let conn = test_conn();
        let result = delete(&conn, Uuid::new_v4());
        assert!(matches!(result, Err(AppError::NotFound)));
    }
}
