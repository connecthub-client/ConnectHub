use std::collections::HashMap;

use rusqlite::{Connection, OptionalExtension};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::tag::Tag;

fn row_to_tag(row: &rusqlite::Row) -> rusqlite::Result<Tag> {
    Ok(Tag {
        id: row.get(0)?,
        label: row.get(1)?,
    })
}

pub fn list(conn: &Connection) -> AppResult<Vec<Tag>> {
    let mut stmt = conn.prepare("SELECT id, label FROM tags ORDER BY label")?;
    let rows = stmt.query_map((), row_to_tag)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

// Get-or-create by label (case-sensitive, matching the UNIQUE constraint) -
// the frontend calls this both when a user picks an existing tag and when
// they type a brand-new one, so it never has to distinguish the two cases
// itself or race against another tab creating the same label.
pub fn get_or_create(conn: &Connection, label: &str) -> AppResult<Tag> {
    let label = label.trim();
    if let Some(existing) = conn
        .query_row("SELECT id, label FROM tags WHERE label = ?1", (&label,), row_to_tag)
        .optional()?
    {
        return Ok(existing);
    }

    let id = Uuid::new_v4();
    conn.execute("INSERT INTO tags (id, label) VALUES (?1, ?2)", (&id, &label))?;
    Ok(Tag { id, label: label.to_string() })
}

pub fn delete(conn: &Connection, id: Uuid) -> AppResult<()> {
    // host_tags rows referencing this tag are cleaned up by the table's own
    // ON DELETE CASCADE - no manual cleanup needed here, unlike
    // vpn_profiles::delete (which predates having a REFERENCES clause on
    // the column it cleans up after).
    let changed = conn.execute("DELETE FROM tags WHERE id = ?1", (&id,))?;
    if changed == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

pub fn list_by_host(conn: &Connection, host_id: Uuid) -> AppResult<Vec<Tag>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.label FROM tags t
         INNER JOIN host_tags ht ON ht.tag_id = t.id
         WHERE ht.host_id = ?1
         ORDER BY t.label",
    )?;
    let rows = stmt.query_map((&host_id,), row_to_tag)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

// Every host's tags in one query, keyed by host_id - used by hosts::list so
// listing every host doesn't run one extra query per host.
pub fn list_by_host_bulk(conn: &Connection) -> AppResult<HashMap<Uuid, Vec<Tag>>> {
    let mut stmt = conn.prepare(
        "SELECT ht.host_id, t.id, t.label FROM host_tags ht
         INNER JOIN tags t ON t.id = ht.tag_id
         ORDER BY t.label",
    )?;
    let rows = stmt.query_map((), |row| {
        let host_id: Uuid = row.get(0)?;
        Ok((host_id, Tag { id: row.get(1)?, label: row.get(2)? }))
    })?;

    let mut by_host: HashMap<Uuid, Vec<Tag>> = HashMap::new();
    for row in rows {
        let (host_id, tag) = row?;
        by_host.entry(host_id).or_default().push(tag);
    }
    Ok(by_host)
}

// Replace-all semantics, mirroring how hosts::update replaces every scalar
// field wholesale rather than diffing - simplest correct behavior for a
// form that submits the full desired tag set on every save.
pub fn set_host_tags(conn: &Connection, host_id: Uuid, tag_ids: &[Uuid]) -> AppResult<()> {
    conn.execute("DELETE FROM host_tags WHERE host_id = ?1", (&host_id,))?;
    for tag_id in tag_ids {
        conn.execute(
            "INSERT INTO host_tags (host_id, tag_id) VALUES (?1, ?2)",
            (&host_id, tag_id),
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::hosts;
    use crate::models::host::HostInput;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::data::init_schema(&conn).unwrap();
        conn
    }

    fn host_input() -> HostInput {
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
            tag_ids: Vec::new(),
        }
    }

    #[test]
    fn get_or_create_returns_the_same_tag_for_a_repeated_label() {
        let conn = test_conn();
        let first = get_or_create(&conn, "prod").unwrap();
        let second = get_or_create(&conn, "prod").unwrap();
        assert_eq!(first.id, second.id);
        assert_eq!(list(&conn).unwrap().len(), 1);
    }

    #[test]
    fn get_or_create_trims_whitespace() {
        let conn = test_conn();
        let a = get_or_create(&conn, "prod").unwrap();
        let b = get_or_create(&conn, "  prod  ").unwrap();
        assert_eq!(a.id, b.id);
    }

    #[test]
    fn set_host_tags_attaches_and_replaces() {
        let conn = test_conn();
        let host = hosts::create(&conn, host_input()).unwrap();
        let prod = get_or_create(&conn, "prod").unwrap();
        let db = get_or_create(&conn, "db").unwrap();

        set_host_tags(&conn, host.id, &[prod.id, db.id]).unwrap();
        let tags = list_by_host(&conn, host.id).unwrap();
        assert_eq!(tags.len(), 2);

        // Replacing with a smaller set drops the ones no longer listed.
        set_host_tags(&conn, host.id, &[db.id]).unwrap();
        let tags = list_by_host(&conn, host.id).unwrap();
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].label, "db");
    }

    #[test]
    fn deleting_a_tag_removes_it_from_every_host_via_cascade() {
        let conn = test_conn();
        let host = hosts::create(&conn, host_input()).unwrap();
        let prod = get_or_create(&conn, "prod").unwrap();
        set_host_tags(&conn, host.id, &[prod.id]).unwrap();

        delete(&conn, prod.id).unwrap();

        assert!(list_by_host(&conn, host.id).unwrap().is_empty());
        assert!(list(&conn).unwrap().is_empty());
    }

    #[test]
    fn deleting_a_host_removes_its_host_tags_rows_via_cascade() {
        let conn = test_conn();
        let host = hosts::create(&conn, host_input()).unwrap();
        let prod = get_or_create(&conn, "prod").unwrap();
        set_host_tags(&conn, host.id, &[prod.id]).unwrap();

        hosts::delete(&conn, host.id).unwrap();

        // The tag itself survives (it may be used by other hosts); only the
        // join row for this host is gone.
        assert_eq!(list(&conn).unwrap().len(), 1);
        let bulk = list_by_host_bulk(&conn).unwrap();
        assert!(bulk.is_empty());
    }

    #[test]
    fn list_by_host_bulk_groups_by_host() {
        let conn = test_conn();
        let host_a = hosts::create(&conn, HostInput { label: "a".into(), ..host_input() }).unwrap();
        let host_b = hosts::create(&conn, HostInput { label: "b".into(), ..host_input() }).unwrap();
        let prod = get_or_create(&conn, "prod").unwrap();
        let db = get_or_create(&conn, "db").unwrap();

        set_host_tags(&conn, host_a.id, &[prod.id, db.id]).unwrap();
        set_host_tags(&conn, host_b.id, &[prod.id]).unwrap();

        let bulk = list_by_host_bulk(&conn).unwrap();
        assert_eq!(bulk.get(&host_a.id).unwrap().len(), 2);
        assert_eq!(bulk.get(&host_b.id).unwrap().len(), 1);
    }

    #[test]
    fn delete_nonexistent_tag_fails() {
        let conn = test_conn();
        let result = delete(&conn, Uuid::new_v4());
        assert!(matches!(result, Err(AppError::NotFound)));
    }
}
