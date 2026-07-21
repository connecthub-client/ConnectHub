use std::collections::HashMap;

use rusqlite::Connection;
use serde::Serialize;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::group::GroupInput;
use crate::models::host::HostInput;

use super::{groups, hosts, identities};

// Secrets (passwords/private keys) never appear in the CSV - only enough of
// an identity to let it be matched against one that already exists on the
// importing machine. Re-linking credentials after import is a deliberate
// manual step, not a gap.
#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct HostRecord {
    label: String,
    hostname: String,
    port: u16,
    group_path: String,
    identity_label: String,
    identity_username: String,
    jump_host_label: String,
    notes: String,
}

fn group_path(id: Uuid, by_id: &HashMap<Uuid, (String, Option<Uuid>)>) -> String {
    let mut parts = Vec::new();
    let mut current = Some(id);
    // Bounded by the number of groups that exist - a cycle can't occur since
    // group parents are only ever set through validated CRUD operations, but
    // capping the walk keeps this safe even against a hand-edited database.
    for _ in 0..by_id.len() + 1 {
        let Some(cur) = current else { break };
        let Some((name, parent_id)) = by_id.get(&cur) else {
            break;
        };
        parts.push(name.clone());
        current = *parent_id;
    }
    parts.reverse();
    parts.join("/")
}

pub fn export_csv(conn: &Connection) -> AppResult<String> {
    let all_groups = groups::list(conn)?;
    let all_identities = identities::list(conn)?;
    let all_hosts = hosts::list(conn)?;

    let group_by_id: HashMap<Uuid, (String, Option<Uuid>)> = all_groups
        .iter()
        .map(|g| (g.id, (g.name.clone(), g.parent_id)))
        .collect();
    let identity_by_id: HashMap<Uuid, (String, String)> = all_identities
        .iter()
        .map(|i| (i.id, (i.label.clone(), i.username.clone())))
        .collect();
    let host_label_by_id: HashMap<Uuid, String> =
        all_hosts.iter().map(|h| (h.id, h.label.clone())).collect();

    let mut writer = csv::Writer::from_writer(Vec::new());
    for host in &all_hosts {
        let (identity_label, identity_username) = host
            .identity_id
            .and_then(|id| identity_by_id.get(&id))
            .cloned()
            .unwrap_or_default();

        writer
            .serialize(HostRecord {
                label: host.label.clone(),
                hostname: host.hostname.clone(),
                port: host.port,
                group_path: host
                    .group_id
                    .map(|id| group_path(id, &group_by_id))
                    .unwrap_or_default(),
                identity_label,
                identity_username,
                jump_host_label: host
                    .jump_host_id
                    .and_then(|id| host_label_by_id.get(&id))
                    .cloned()
                    .unwrap_or_default(),
                notes: host.notes.clone().unwrap_or_default(),
            })
            .map_err(|e| AppError::Csv(e.to_string()))?;
    }

    let bytes = writer.into_inner().map_err(|e| AppError::Csv(e.to_string()))?;
    String::from_utf8(bytes).map_err(|e| AppError::Csv(e.to_string()))
}

#[derive(Debug, Serialize)]
pub struct ImportSummary {
    pub imported: usize,
    pub updated: usize,
    pub warnings: Vec<String>,
}

// Resolves (creating as needed) the nested group chain for a "Parent/Child"
// path, memoizing already-resolved paths so repeated rows sharing a group
// only create it once.
fn resolve_group_path(
    conn: &Connection,
    path: &str,
    cache: &mut HashMap<String, Uuid>,
) -> AppResult<Option<Uuid>> {
    let path = path.trim();
    if path.is_empty() {
        return Ok(None);
    }
    if let Some(id) = cache.get(path) {
        return Ok(Some(*id));
    }

    let mut parent_id: Option<Uuid> = None;
    let mut built = String::new();
    for segment in path.split('/').map(str::trim).filter(|s| !s.is_empty()) {
        if !built.is_empty() {
            built.push('/');
        }
        built.push_str(segment);

        if let Some(id) = cache.get(&built) {
            parent_id = Some(*id);
            continue;
        }

        let existing = groups::list(conn)?
            .into_iter()
            .find(|g| g.parent_id == parent_id && g.name == segment);
        let id = match existing {
            Some(g) => g.id,
            None => {
                groups::create(
                    conn,
                    GroupInput {
                        parent_id,
                        name: segment.to_string(),
                        sort_order: 0,
                    },
                )?
                .id
            }
        };
        cache.insert(built.clone(), id);
        parent_id = Some(id);
    }

    Ok(parent_id)
}

pub fn import_csv(conn: &Connection, content: &str) -> AppResult<ImportSummary> {
    let mut reader = csv::Reader::from_reader(content.as_bytes());
    let records: Vec<HostRecord> = reader
        .deserialize()
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| AppError::Csv(e.to_string()))?;

    let all_identities = identities::list(conn)?;
    // label -> existing Host, for matching a row against a host that already
    // exists (re-importing a previously-exported/updated inventory should
    // update that host in place rather than create a duplicate every time)
    // and for preserving fields the CSV doesn't carry (vpn_profile_id,
    // color, sort_order) instead of blanking them out on update.
    let existing_by_label: HashMap<String, crate::models::host::Host> =
        hosts::list(conn)?.into_iter().map(|h| (h.label.clone(), h)).collect();
    let mut warnings = Vec::new();
    let mut group_cache = HashMap::new();
    // label -> id, for resolving jump-host references in the second pass
    // below (including references between two hosts in this same import).
    let mut created_by_label: HashMap<String, Uuid> = HashMap::new();
    let mut imported = 0usize;
    let mut updated = 0usize;
    // Row order preserved alongside each row's raw jump_host_label so the
    // second pass can look it up without re-parsing the CSV.
    let mut pending_jump_links: Vec<(Uuid, String)> = Vec::new();

    for (i, record) in records.iter().enumerate() {
        let row_num = i + 2; // 1-indexed + header row

        let group_id = resolve_group_path(conn, &record.group_path, &mut group_cache)?;

        // Both label AND username must match an existing identity exactly -
        // matching on username alone (as an earlier version of this did)
        // lets a CSV that only sets identity_username to a common guessed
        // value (root/ubuntu/admin/...) silently attach whichever saved
        // identity happens to have that username, sending its real
        // password/key to whatever hostname the row specifies. A label is
        // a user-chosen string an attacker preparing a malicious "host
        // list" CSV can't predict, so requiring it closes that off; a
        // legitimate self-exported CSV (see export_csv above) always sets
        // both fields together anyway.
        let identity_id = if record.identity_username.trim().is_empty()
            || record.identity_label.trim().is_empty()
        {
            None
        } else {
            all_identities
                .iter()
                .find(|ident| {
                    ident.username == record.identity_username && ident.label == record.identity_label
                })
                .map(|ident| ident.id)
        };
        if identity_id.is_none() && !record.identity_username.trim().is_empty() {
            warnings.push(format!(
                "Row {row_num} ({}): no saved identity matches \"{}\" ({}) - \
                 imported without credentials, re-link it manually.",
                record.label, record.identity_label, record.identity_username
            ));
        }

        let notes = if record.notes.trim().is_empty() { None } else { Some(record.notes.clone()) };

        let host = match existing_by_label.get(&record.label) {
            // Update in place: preserves the host's id (and anything
            // referencing it, e.g. an open session or another host's
            // jump_host_id), and its vpn_profile_id/color - none of which
            // the CSV format carries - rather than creating a second host
            // with the same label, or blanking those fields, every time the
            // same export is re-imported.
            Some(existing) => {
                updated += 1;
                hosts::update(
                    conn,
                    existing.id,
                    HostInput {
                        group_id,
                        label: record.label.clone(),
                        hostname: record.hostname.clone(),
                        port: record.port,
                        identity_id,
                        // Left unset here and resolved in the second pass
                        // below (same as for a newly-created host), so a
                        // row whose jump_host_label changed - or was
                        // cleared - between exports is reflected exactly,
                        // rather than only ever able to add a jump host on
                        // re-import and never remove one.
                        jump_host_id: None,
                        vpn_profile_id: existing.vpn_profile_id,
                        color: existing.color.clone(),
                        notes,
                        sort_order: existing.sort_order,
                    },
                )?
            }
            None => {
                imported += 1;
                hosts::create(
                    conn,
                    HostInput {
                        group_id,
                        label: record.label.clone(),
                        hostname: record.hostname.clone(),
                        port: record.port,
                        identity_id,
                        jump_host_id: None,
                        vpn_profile_id: None,
                        color: None,
                        notes,
                        sort_order: 0,
                    },
                )?
            }
        };

        created_by_label.insert(record.label.clone(), host.id);
        if !record.jump_host_label.trim().is_empty() {
            pending_jump_links.push((host.id, record.jump_host_label.clone()));
        }
    }

    // Second pass: jump hosts may reference another host imported in this
    // same batch, so this only runs once every row has been created.
    let all_hosts = hosts::list(conn)?;
    for (host_id, jump_label) in pending_jump_links {
        let jump_target = created_by_label
            .get(&jump_label)
            .copied()
            .or_else(|| all_hosts.iter().find(|h| h.label == jump_label).map(|h| h.id));

        match jump_target {
            Some(jump_id) if jump_id != host_id => {
                let host = hosts::get(conn, host_id)?;
                hosts::update(
                    conn,
                    host_id,
                    HostInput {
                        group_id: host.group_id,
                        label: host.label,
                        hostname: host.hostname,
                        port: host.port,
                        identity_id: host.identity_id,
                        jump_host_id: Some(jump_id),
                        vpn_profile_id: host.vpn_profile_id,
                        color: host.color,
                        notes: host.notes,
                        sort_order: host.sort_order,
                    },
                )?;
            }
            _ => {
                warnings.push(format!(
                    "Jump host \"{jump_label}\" not found for an imported host - left unset."
                ));
            }
        }
    }

    Ok(ImportSummary {
        imported,
        updated,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::identity::{AuthMethod, IdentityInput};
    use crate::vault::kdf::test_key;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::data::init_schema(&conn).unwrap();
        conn
    }

    #[test]
    fn export_includes_group_path_identity_and_jump_host() {
        let conn = test_conn();
        let key = test_key();

        let parent = groups::create(
            &conn,
            GroupInput {
                parent_id: None,
                name: "Production".into(),
                sort_order: 0,
            },
        )
        .unwrap();
        let child = groups::create(
            &conn,
            GroupInput {
                parent_id: Some(parent.id),
                name: "US-East".into(),
                sort_order: 0,
            },
        )
        .unwrap();
        let identity = identities::create(
            &conn,
            &key,
            IdentityInput {
                label: "deploy".into(),
                username: "root".into(),
                auth_method: AuthMethod::Password,
                ssh_key_id: None,
                password: Some("hunter2".into()),
            },
        )
        .unwrap();
        let bastion = hosts::create(
            &conn,
            HostInput {
                group_id: None,
                label: "bastion".into(),
                hostname: "10.0.0.1".into(),
                port: 22,
                identity_id: None,
                jump_host_id: None,
                vpn_profile_id: None,
                color: None,
                notes: None,
                sort_order: 0,
            },
        )
        .unwrap();
        hosts::create(
            &conn,
            HostInput {
                group_id: Some(child.id),
                label: "web-1".into(),
                hostname: "10.0.0.5".into(),
                port: 2222,
                identity_id: Some(identity.id),
                jump_host_id: Some(bastion.id),
                vpn_profile_id: None,
                color: None,
                notes: Some("primary web node".into()),
                sort_order: 0,
            },
        )
        .unwrap();

        let csv = export_csv(&conn).unwrap();
        assert!(csv.contains("Production/US-East"));
        assert!(csv.contains("deploy"));
        assert!(csv.contains("root"));
        assert!(csv.contains("bastion"));
        assert!(csv.contains("primary web node"));
        // Secrets must never appear in the export.
        assert!(!csv.contains("hunter2"));
    }

    #[test]
    fn import_roundtrips_group_path_and_matches_existing_identity() {
        let conn = test_conn();
        let key = test_key();

        // Identity must already exist on the "importing" side - the CSV
        // only carries enough to match it, never the secret itself.
        identities::create(
            &conn,
            &key,
            IdentityInput {
                label: "deploy".into(),
                username: "root".into(),
                auth_method: AuthMethod::Password,
                ssh_key_id: None,
                password: Some("hunter2".into()),
            },
        )
        .unwrap();

        let csv = "label,hostname,port,group_path,identity_label,identity_username,jump_host_label,notes\n\
                   bastion,10.0.0.1,22,,,,,\n\
                   web-1,10.0.0.5,2222,Production/US-East,deploy,root,bastion,primary web node\n";

        let summary = import_csv(&conn, csv).unwrap();
        assert_eq!(summary.imported, 2);
        assert!(summary.warnings.is_empty(), "unexpected warnings: {:?}", summary.warnings);

        let all_hosts = hosts::list(&conn).unwrap();
        let web1 = all_hosts.iter().find(|h| h.label == "web-1").unwrap();
        let bastion = all_hosts.iter().find(|h| h.label == "bastion").unwrap();

        assert_eq!(web1.jump_host_id, Some(bastion.id));
        assert_eq!(web1.notes.as_deref(), Some("primary web node"));
        assert!(web1.identity_id.is_some());

        let all_groups = groups::list(&conn).unwrap();
        let us_east = all_groups.iter().find(|g| g.name == "US-East").unwrap();
        let production = all_groups.iter().find(|g| g.name == "Production").unwrap();
        assert_eq!(us_east.parent_id, Some(production.id));
        assert_eq!(web1.group_id, Some(us_east.id));
    }

    #[test]
    fn import_warns_but_continues_when_identity_is_missing() {
        let conn = test_conn();
        let csv = "label,hostname,port,group_path,identity_label,identity_username,jump_host_label,notes\n\
                   orphan,10.0.0.9,22,,ghost,nobody,,\n";

        let summary = import_csv(&conn, csv).unwrap();
        assert_eq!(summary.imported, 1);
        assert_eq!(summary.warnings.len(), 1);

        let all_hosts = hosts::list(&conn).unwrap();
        assert_eq!(all_hosts[0].identity_id, None);
    }

    #[test]
    fn import_does_not_auto_link_an_identity_by_username_alone_when_label_is_blank() {
        let conn = test_conn();
        let key = test_key();

        // A saved identity with a common, guessable username.
        identities::create(
            &conn,
            &key,
            IdentityInput {
                label: "my real prod key".into(),
                username: "root".into(),
                auth_method: AuthMethod::Password,
                ssh_key_id: None,
                password: Some("hunter2".into()),
            },
        )
        .unwrap();

        // A crafted CSV that only sets identity_username (guessing "root"),
        // leaving identity_label blank, pointed at an arbitrary hostname.
        let csv = "label,hostname,port,group_path,identity_label,identity_username,jump_host_label,notes\n\
                   totally-legit-host,attacker.example.com,22,,,root,,\n";

        let summary = import_csv(&conn, csv).unwrap();
        assert_eq!(summary.imported, 1);
        assert_eq!(
            summary.warnings.len(),
            1,
            "must warn instead of silently attaching credentials by username alone"
        );

        let all_hosts = hosts::list(&conn).unwrap();
        assert_eq!(
            all_hosts[0].identity_id, None,
            "must not link a saved identity's real credentials by username match alone"
        );
    }

    #[test]
    fn reimporting_the_same_csv_updates_the_existing_host_in_place() {
        let conn = test_conn();
        let csv = "label,hostname,port,group_path,identity_label,identity_username,jump_host_label,notes\n\
                   web-1,10.0.0.5,22,,,,,\n";

        let first = import_csv(&conn, csv).unwrap();
        assert_eq!((first.imported, first.updated), (1, 0));

        let second = import_csv(&conn, csv).unwrap();
        assert_eq!(
            (second.imported, second.updated),
            (0, 1),
            "re-importing the same label must update, not duplicate"
        );

        let all_hosts = hosts::list(&conn).unwrap();
        assert_eq!(all_hosts.len(), 1, "must not create a second host for the same label");
    }

    #[test]
    fn reimporting_preserves_vpn_profile_id_and_updates_changed_fields() {
        use crate::models::vpn_profile::VpnProfileInput;

        let conn = test_conn();
        let key = test_key();
        let profile = crate::data::vpn_profiles::create(
            &conn,
            &key,
            VpnProfileInput {
                label: "office".into(),
                config: "client\nremote vpn.example.com 1194\n".into(),
                auth_username: None,
                auth_password: None,
                avoid_default_route: true,
            },
        )
        .unwrap();

        let csv = "label,hostname,port,group_path,identity_label,identity_username,jump_host_label,notes\n\
                   web-1,10.0.0.5,22,,,,,\n";
        let created = import_csv(&conn, csv).unwrap();
        assert_eq!(created.imported, 1);

        let host = hosts::list(&conn).unwrap().into_iter().find(|h| h.label == "web-1").unwrap();
        hosts::update(
            &conn,
            host.id,
            HostInput {
                group_id: host.group_id,
                label: host.label.clone(),
                hostname: host.hostname.clone(),
                port: host.port,
                identity_id: host.identity_id,
                jump_host_id: host.jump_host_id,
                vpn_profile_id: Some(profile.id),
                color: host.color.clone(),
                notes: host.notes.clone(),
                sort_order: host.sort_order,
            },
        )
        .unwrap();

        // Re-import with a changed hostname - a real "sync my inventory"
        // scenario - must update the hostname but must NOT wipe the VPN
        // profile assignment the CSV format doesn't even carry.
        let updated_csv = "label,hostname,port,group_path,identity_label,identity_username,jump_host_label,notes\n\
                           web-1,10.0.0.99,22,,,,,\n";
        let result = import_csv(&conn, updated_csv).unwrap();
        assert_eq!((result.imported, result.updated), (0, 1));

        let refreshed = hosts::list(&conn).unwrap().into_iter().find(|h| h.label == "web-1").unwrap();
        assert_eq!(refreshed.hostname, "10.0.0.99");
        assert_eq!(refreshed.vpn_profile_id, Some(profile.id));
    }
}
