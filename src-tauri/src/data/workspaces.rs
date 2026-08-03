use rusqlite::Connection;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::workspace::{Workspace, WorkspaceTab, WorkspaceTabInput};

fn row_to_workspace(row: &rusqlite::Row) -> rusqlite::Result<Workspace> {
    Ok(Workspace {
        id: row.get(0)?,
        label: row.get(1)?,
        sort_order: row.get(2)?,
        created_at: row.get(3)?,
        tab_count: row.get(4)?,
    })
}

pub fn list(conn: &Connection) -> AppResult<Vec<Workspace>> {
    let mut stmt = conn.prepare(
        "SELECT w.id, w.label, w.sort_order, w.created_at,
                (SELECT COUNT(*) FROM workspace_tabs t WHERE t.workspace_id = w.id) AS tab_count
         FROM workspaces w ORDER BY w.sort_order",
    )?;
    let rows = stmt.query_map((), row_to_workspace)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn row_to_tab(row: &rusqlite::Row) -> rusqlite::Result<WorkspaceTab> {
    Ok(WorkspaceTab {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        host_id: row.get(2)?,
        kind: row.get(3)?,
        pane_count: row.get(4)?,
        sort_order: row.get(5)?,
    })
}

pub fn list_tabs(conn: &Connection, workspace_id: Uuid) -> AppResult<Vec<WorkspaceTab>> {
    let mut stmt = conn.prepare(
        "SELECT id, workspace_id, host_id, kind, pane_count, sort_order FROM workspace_tabs
         WHERE workspace_id = ?1 ORDER BY sort_order",
    )?;
    let rows = stmt.query_map((&workspace_id,), row_to_tab)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

// Captures a full "save current layout" action in one call - the tab list
// is fixed at save time (see WorkspaceTabInput's doc comment), so there's
// no separate step to attach tabs afterward.
pub fn create(conn: &Connection, label: &str, tabs: &[WorkspaceTabInput]) -> AppResult<Workspace> {
    let id = Uuid::new_v4();
    let created_at = chrono::Utc::now().to_rfc3339();
    // Appends after every existing workspace rather than defaulting to 0,
    // so newly saved layouts don't jump to the front of the list.
    let sort_order: i32 =
        conn.query_row("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM workspaces", (), |r| r.get(0))?;

    conn.execute(
        "INSERT INTO workspaces (id, label, sort_order, created_at) VALUES (?1, ?2, ?3, ?4)",
        (&id, label, sort_order, &created_at),
    )?;
    for tab in tabs {
        conn.execute(
            "INSERT INTO workspace_tabs (id, workspace_id, host_id, kind, pane_count, sort_order)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            (&Uuid::new_v4(), &id, &tab.host_id, &tab.kind, tab.pane_count, tab.sort_order),
        )?;
    }

    Ok(Workspace { id, label: label.to_string(), sort_order, created_at, tab_count: tabs.len() as i32 })
}

pub fn rename(conn: &Connection, id: Uuid, label: &str) -> AppResult<Workspace> {
    let changed = conn.execute("UPDATE workspaces SET label = ?1 WHERE id = ?2", (label, &id))?;
    if changed == 0 {
        return Err(AppError::NotFound);
    }
    conn.query_row(
        "SELECT w.id, w.label, w.sort_order, w.created_at,
                (SELECT COUNT(*) FROM workspace_tabs t WHERE t.workspace_id = w.id) AS tab_count
         FROM workspaces w WHERE w.id = ?1",
        (&id,),
        row_to_workspace,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => AppError::NotFound,
        other => AppError::Db(other),
    })
}

pub fn delete(conn: &Connection, id: Uuid) -> AppResult<()> {
    let changed = conn.execute("DELETE FROM workspaces WHERE id = ?1", (&id,))?;
    if changed == 0 {
        return Err(AppError::NotFound);
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

    fn host_input(label: &str) -> HostInput {
        HostInput {
            group_id: None,
            label: label.into(),
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
    fn create_and_list_roundtrips_with_tab_count() {
        let conn = test_conn();
        let host_a = hosts::create(&conn, host_input("a")).unwrap();
        let host_b = hosts::create(&conn, host_input("b")).unwrap();

        let tabs = vec![
            WorkspaceTabInput { host_id: host_a.id, kind: "terminal".into(), pane_count: 2, sort_order: 0 },
            WorkspaceTabInput { host_id: host_b.id, kind: "sftp".into(), pane_count: 1, sort_order: 1 },
        ];
        let created = create(&conn, "my layout", &tabs).unwrap();
        assert_eq!(created.tab_count, 2);

        let listed = list(&conn).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, created.id);
        assert_eq!(listed[0].label, "my layout");
        assert_eq!(listed[0].tab_count, 2);
    }

    #[test]
    fn list_tabs_returns_them_in_sort_order() {
        let conn = test_conn();
        let host_a = hosts::create(&conn, host_input("a")).unwrap();
        let host_b = hosts::create(&conn, host_input("b")).unwrap();

        let tabs = vec![
            WorkspaceTabInput { host_id: host_b.id, kind: "terminal".into(), pane_count: 1, sort_order: 1 },
            WorkspaceTabInput { host_id: host_a.id, kind: "terminal".into(), pane_count: 3, sort_order: 0 },
        ];
        let created = create(&conn, "my layout", &tabs).unwrap();

        let listed_tabs = list_tabs(&conn, created.id).unwrap();
        assert_eq!(listed_tabs.len(), 2);
        assert_eq!(listed_tabs[0].host_id, host_a.id);
        assert_eq!(listed_tabs[0].pane_count, 3);
        assert_eq!(listed_tabs[1].host_id, host_b.id);
    }

    #[test]
    fn second_workspace_appends_after_the_first_by_sort_order() {
        let conn = test_conn();
        let host = hosts::create(&conn, host_input("a")).unwrap();
        let tabs = vec![WorkspaceTabInput { host_id: host.id, kind: "terminal".into(), pane_count: 1, sort_order: 0 }];

        let first = create(&conn, "first", &tabs).unwrap();
        let second = create(&conn, "second", &tabs).unwrap();
        assert!(second.sort_order > first.sort_order);
    }

    #[test]
    fn rename_updates_the_label_and_preserves_tab_count() {
        let conn = test_conn();
        let host = hosts::create(&conn, host_input("a")).unwrap();
        let tabs = vec![WorkspaceTabInput { host_id: host.id, kind: "terminal".into(), pane_count: 1, sort_order: 0 }];
        let created = create(&conn, "old name", &tabs).unwrap();

        let renamed = rename(&conn, created.id, "new name").unwrap();
        assert_eq!(renamed.label, "new name");
        assert_eq!(renamed.tab_count, 1);
    }

    #[test]
    fn rename_nonexistent_workspace_fails() {
        let conn = test_conn();
        let result = rename(&conn, Uuid::new_v4(), "x");
        assert!(matches!(result, Err(AppError::NotFound)));
    }

    #[test]
    fn deleting_a_workspace_removes_its_tabs_via_cascade() {
        let conn = test_conn();
        let host = hosts::create(&conn, host_input("a")).unwrap();
        let tabs = vec![WorkspaceTabInput { host_id: host.id, kind: "terminal".into(), pane_count: 1, sort_order: 0 }];
        let created = create(&conn, "my layout", &tabs).unwrap();

        delete(&conn, created.id).unwrap();

        assert!(list(&conn).unwrap().is_empty());
        assert!(list_tabs(&conn, created.id).unwrap().is_empty());
    }

    #[test]
    fn delete_nonexistent_workspace_fails() {
        let conn = test_conn();
        let result = delete(&conn, Uuid::new_v4());
        assert!(matches!(result, Err(AppError::NotFound)));
    }

    #[test]
    fn deleting_a_host_removes_only_the_workspace_tabs_that_reference_it() {
        let conn = test_conn();
        let host_a = hosts::create(&conn, host_input("a")).unwrap();
        let host_b = hosts::create(&conn, host_input("b")).unwrap();
        let tabs = vec![
            WorkspaceTabInput { host_id: host_a.id, kind: "terminal".into(), pane_count: 1, sort_order: 0 },
            WorkspaceTabInput { host_id: host_b.id, kind: "terminal".into(), pane_count: 1, sort_order: 1 },
        ];
        let created = create(&conn, "my layout", &tabs).unwrap();

        hosts::delete(&conn, host_a.id).unwrap();

        let remaining = list_tabs(&conn, created.id).unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].host_id, host_b.id);
        // The workspace itself survives - only the tab referencing the
        // deleted host is gone.
        assert_eq!(list(&conn).unwrap()[0].tab_count, 1);
    }
}
