import { useEffect, useRef, useState } from "react";
import { Group, Host } from "../../lib/tauri-bridge";
import { useHostsStore } from "../../state/hostsStore";
import { useSessionsStore } from "../../state/sessionsStore";
import { useConfirm } from "../common/useConfirm";

interface HostTreeProps {
  selectedHostId: string | null;
  onSelectHost: (host: Host) => void;
  onConnectHost: (host: Host) => void;
  onEditGroup: (group: Group) => void;
  onEditHost: (host: Host) => void;
  onNewHost: (groupId: string | null) => void;
  onNewSubgroup: (parentId: string | null) => void;
}

interface ContextMenuState {
  host: Host;
  x: number;
  y: number;
}

export default function HostTree(props: HostTreeProps) {
  const groups = useHostsStore((s) => s.groups);
  const hosts = useHostsStore((s) => s.hosts);
  const deleteGroup = useHostsStore((s) => s.deleteGroup);
  const deleteHost = useHostsStore((s) => s.deleteHost);
  const createHost = useHostsStore((s) => s.createHost);
  const openSessions = useSessionsStore((s) => s.openSessions);
  const openHostIds = new Set(openSessions.map((s) => s.host.id));
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { confirm, confirmDialog } = useConfirm();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    // Move focus into the menu so Tab/Shift+Tab and Enter work immediately
    // for keyboard users, without requiring a Tab press first to reach it
    // from wherever focus happened to be.
    menuRef.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
    const close = () => setContextMenu(null);
    const onKeyDown = (e: KeyboardEvent) => {
      // Previously closed on ANY keydown, which meant ArrowDown/Enter -
      // the natural way to navigate a menu from the keyboard - dismissed
      // it instead of navigating. Only Escape should close it here; Tab
      // and Enter are left to behave normally on whichever menu button
      // currently has focus.
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [contextMenu]);

  async function handleDuplicate(host: Host) {
    setContextMenu(null);
    await createHost({
      group_id: host.group_id,
      label: `${host.label} (copy)`,
      hostname: host.hostname,
      port: host.port,
      identity_id: host.identity_id,
      jump_host_id: host.jump_host_id,
      vpn_profile_id: host.vpn_profile_id,
      color: host.color,
      notes: host.notes,
      sort_order: host.sort_order,
    });
  }

  function toggle(groupId: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  function renderLevel(parentId: string | null, depth: number) {
    const childGroups = groups
      .filter((g) => g.parent_id === parentId)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    const childHosts = hosts
      .filter((h) => h.group_id === parentId)
      .sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label));

    return (
      <>
        {childGroups.map((group) => (
          <div key={group.id}>
            <div
              className="group flex items-center justify-between rounded px-2 py-1 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
              style={{ paddingLeft: `${depth * 16 + 8}px` }}
            >
              <button
                type="button"
                onClick={() => toggle(group.id)}
                className="flex flex-1 items-center gap-1.5 text-left text-neutral-700 dark:text-neutral-300"
              >
                <span className="w-3 text-xs text-neutral-400">
                  {collapsed.has(group.id) ? "▸" : "▾"}
                </span>
                <span className="font-medium">{group.name}</span>
              </button>
              <div className="hidden gap-1 group-hover:flex">
                <button
                  type="button"
                  title="New host in this group"
                  onClick={() => props.onNewHost(group.id)}
                  className="rounded px-1 text-xs text-neutral-500 hover:text-teal-600"
                >
                  +host
                </button>
                <button
                  type="button"
                  title="New subgroup"
                  onClick={() => props.onNewSubgroup(group.id)}
                  className="rounded px-1 text-xs text-neutral-500 hover:text-teal-600"
                >
                  +grp
                </button>
                <button
                  type="button"
                  title="Edit group"
                  onClick={() => props.onEditGroup(group)}
                  className="rounded px-1 text-xs text-neutral-500 hover:text-teal-600"
                >
                  edit
                </button>
                <button
                  type="button"
                  title="Delete group"
                  onClick={async () => {
                    setDeleteError(null);
                    if (await confirm(`Delete group "${group.name}"? Hosts inside become ungrouped.`, { danger: true })) {
                      try {
                        await deleteGroup(group.id);
                      } catch (err) {
                        setDeleteError(String(err));
                      }
                    }
                  }}
                  className="rounded px-1 text-xs text-neutral-500 hover:text-red-600"
                >
                  del
                </button>
              </div>
            </div>
            {!collapsed.has(group.id) && renderLevel(group.id, depth + 1)}
          </div>
        ))}

        {childHosts.map((host) => (
          <div
            key={host.id}
            className={`group flex items-center justify-between rounded px-2 py-1 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
              props.selectedHostId === host.id ? "bg-teal-50 dark:bg-teal-950" : ""
            }`}
            style={{ paddingLeft: `${depth * 16 + 24}px` }}
          >
            <button
              type="button"
              onClick={() => props.onSelectHost(host)}
              onDoubleClick={() => {
                if (host.identity_id) props.onConnectHost(host);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                props.onSelectHost(host);
                setContextMenu({ host, x: e.clientX, y: e.clientY });
              }}
              title={host.identity_id ? "Double-click to connect" : undefined}
              className="flex flex-1 items-center gap-1.5 text-left text-neutral-700 dark:text-neutral-300"
            >
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  openHostIds.has(host.id) ? "bg-emerald-500" : "bg-neutral-300 dark:bg-neutral-700"
                }`}
              />
              <span className="truncate">{host.label}</span>
              <span className="shrink-0 text-xs text-neutral-400">{host.hostname}</span>
            </button>
            <div className="hidden gap-1 group-hover:flex">
              <button
                type="button"
                title="Edit host"
                onClick={() => props.onEditHost(host)}
                className="rounded px-1 text-xs text-neutral-500 hover:text-teal-600"
              >
                edit
              </button>
              <button
                type="button"
                title="Delete host"
                onClick={async () => {
                  setDeleteError(null);
                  if (await confirm(`Delete host "${host.label}"?`, { danger: true })) {
                    try {
                      await deleteHost(host.id);
                    } catch (err) {
                      setDeleteError(String(err));
                    }
                  }
                }}
                className="rounded px-1 text-xs text-neutral-500 hover:text-red-600"
              >
                del
              </button>
            </div>
          </div>
        ))}
      </>
    );
  }

  const menu = contextMenu && (
    <div
      ref={menuRef}
      role="menu"
      className="fixed z-50 w-40 rounded-md border border-neutral-200 bg-white py-1 text-sm shadow-lg dark:border-neutral-700 dark:bg-neutral-800"
      style={{ top: contextMenu.y, left: contextMenu.x }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        disabled={!contextMenu.host.identity_id}
        onClick={() => {
          props.onConnectHost(contextMenu.host);
          setContextMenu(null);
        }}
        className="block w-full px-3 py-1.5 text-left text-neutral-700 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:text-neutral-300 dark:text-neutral-200 dark:hover:bg-neutral-700 dark:disabled:text-neutral-600"
      >
        Connect
      </button>
      <button
        type="button"
        onClick={() => handleDuplicate(contextMenu.host)}
        className="block w-full px-3 py-1.5 text-left text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700"
      >
        Duplicate
      </button>
      <button
        type="button"
        onClick={() => {
          props.onEditHost(contextMenu.host);
          setContextMenu(null);
        }}
        className="block w-full px-3 py-1.5 text-left text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700"
      >
        Edit
      </button>
      <button
        type="button"
        onClick={async () => {
          const host = contextMenu.host;
          setContextMenu(null);
          setDeleteError(null);
          if (await confirm(`Delete host "${host.label}"?`, { danger: true })) {
            try {
              await deleteHost(host.id);
            } catch (err) {
              setDeleteError(String(err));
            }
          }
        }}
        className="block w-full px-3 py-1.5 text-left text-red-600 hover:bg-neutral-100 dark:hover:bg-neutral-700"
      >
        Delete
      </button>
    </div>
  );

  if (groups.length === 0 && hosts.length === 0) {
    return (
      <>
        <p className="px-2 py-4 text-sm text-neutral-400">
          No hosts yet. Use "New host" above to add one.
        </p>
        {confirmDialog}
      </>
    );
  }

  return (
    <div>
      {deleteError && (
        <p className="mx-2 mb-2 rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:bg-red-950 dark:text-red-400">
          {deleteError}
        </p>
      )}
      {renderLevel(null, 0)}
      {menu}
      {confirmDialog}
    </div>
  );
}
