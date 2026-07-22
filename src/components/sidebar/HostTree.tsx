import { useEffect, useRef, useState } from "react";
import { Group, Host } from "../../lib/tauri-bridge";
import { useHostsStore } from "../../state/hostsStore";
import { useSessionsStore } from "../../state/sessionsStore";
import { useConfirm } from "../common/useConfirm";
import { HostIcon } from "../common/hostIcons";

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

const RECENT_LIMIT = 5;

export default function HostTree(props: HostTreeProps) {
  const groups = useHostsStore((s) => s.groups);
  const hosts = useHostsStore((s) => s.hosts);
  const deleteGroup = useHostsStore((s) => s.deleteGroup);
  const deleteHost = useHostsStore((s) => s.deleteHost);
  const createHost = useHostsStore((s) => s.createHost);
  const toggleHostFavorite = useHostsStore((s) => s.toggleHostFavorite);
  const openSessions = useSessionsStore((s) => s.openSessions);
  const openHostIds = new Set(openSessions.map((s) => s.host.id));
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
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
      vpn_profile_id: host.vpn_profile_id,
      color: host.color,
      icon: host.icon,
      notes: host.notes,
      sort_order: host.sort_order,
    });
  }

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function hostMatches(host: Host): boolean {
    if (!query) return true;
    return host.label.toLowerCase().includes(query) || host.hostname.toLowerCase().includes(query);
  }

  // A group is worth showing while searching if any host anywhere inside
  // it (directly, or inside a nested subgroup) matches - otherwise a
  // matching host several levels deep would have every ancestor group
  // filtered out along with it.
  function groupHasMatch(groupId: string): boolean {
    if (!query) return true;
    if (hosts.some((h) => h.group_id === groupId && hostMatches(h))) return true;
    return groups.some((g) => g.parent_id === groupId && groupHasMatch(g.id));
  }

  async function handleDeleteHost(host: Host) {
    setContextMenu(null);
    setDeleteError(null);
    if (await confirm(`Delete host "${host.label}"?`, { danger: true })) {
      try {
        await deleteHost(host.id);
      } catch (err) {
        setDeleteError(String(err));
      }
    }
  }

  // Shared row markup for a host, used both inside the group tree (with
  // indentation) and in the flat Favorites/Recent sections (depth 0).
  function renderHostRow(host: Host, depth: number) {
    return (
      <div
        key={host.id}
        className={`group flex items-center justify-between rounded px-2 py-1 text-sm hover:bg-slate-100 dark:hover:bg-slate-800 ${
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
          className="flex flex-1 items-center gap-1.5 text-left text-slate-700 dark:text-slate-300"
        >
          {host.icon ? (
            <HostIcon
              icon={host.icon}
              className="h-3.5 w-3.5 shrink-0"
              style={{ color: host.color ?? undefined }}
            />
          ) : (
            host.color && (
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: host.color }}
                title="Host color"
              />
            )
          )}
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              openHostIds.has(host.id) ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-700"
            }`}
          />
          <span className="truncate">{host.label}</span>
          <span className="shrink-0 text-xs text-slate-400">{host.hostname}</span>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            title={host.is_favorite ? "Remove from favorites" : "Add to favorites"}
            onClick={() => toggleHostFavorite(host.id, !host.is_favorite)}
            className={`rounded px-1 text-xs ${
              host.is_favorite
                ? "text-amber-500"
                : "text-slate-300 opacity-0 hover:text-amber-500 group-hover:opacity-100 dark:text-slate-600"
            }`}
          >
            {host.is_favorite ? "★" : "☆"}
          </button>
          <div className="hidden gap-1 group-hover:flex">
            <button
              type="button"
              title="Edit host"
              onClick={() => props.onEditHost(host)}
              className="rounded px-1 text-xs text-slate-500 hover:text-teal-600"
            >
              edit
            </button>
            <button
              type="button"
              title="Delete host"
              onClick={() => handleDeleteHost(host)}
              className="rounded px-1 text-xs text-slate-500 hover:text-red-600"
            >
              del
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderLevel(parentId: string | null, depth: number) {
    const childGroups = groups
      .filter((g) => g.parent_id === parentId && groupHasMatch(g.id))
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    const childHosts = hosts
      .filter((h) => h.group_id === parentId && hostMatches(h))
      .sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label));

    return (
      <>
        {childGroups.map((group) => (
          <div key={group.id}>
            <div
              className="group flex items-center justify-between rounded px-2 py-1 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
              style={{ paddingLeft: `${depth * 16 + 8}px` }}
            >
              <button
                type="button"
                onClick={() => toggle(group.id)}
                className="flex flex-1 items-center gap-1.5 text-left text-slate-700 dark:text-slate-300"
              >
                <span className="w-3 text-xs text-slate-400">
                  {!query && collapsed.has(group.id) ? "▸" : "▾"}
                </span>
                <span className="font-medium">{group.name}</span>
              </button>
              <div className="hidden gap-1 group-hover:flex">
                <button
                  type="button"
                  title="New host in this group"
                  onClick={() => props.onNewHost(group.id)}
                  className="rounded px-1 text-xs text-slate-500 hover:text-teal-600"
                >
                  +host
                </button>
                <button
                  type="button"
                  title="New subgroup"
                  onClick={() => props.onNewSubgroup(group.id)}
                  className="rounded px-1 text-xs text-slate-500 hover:text-teal-600"
                >
                  +grp
                </button>
                <button
                  type="button"
                  title="Edit group"
                  onClick={() => props.onEditGroup(group)}
                  className="rounded px-1 text-xs text-slate-500 hover:text-teal-600"
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
                  className="rounded px-1 text-xs text-slate-500 hover:text-red-600"
                >
                  del
                </button>
              </div>
            </div>
            {(query || !collapsed.has(group.id)) && renderLevel(group.id, depth + 1)}
          </div>
        ))}

        {childHosts.map((host) => renderHostRow(host, depth))}
      </>
    );
  }

  function SectionHeader({ id, label, count }: { id: string; label: string; count?: number }) {
    const isCollapsed = collapsed.has(id);
    return (
      <button
        type="button"
        onClick={() => toggle(id)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
      >
        <span className="w-3 text-xs normal-case">{isCollapsed ? "▸" : "▾"}</span>
        <span>{label}</span>
        {count !== undefined && (
          <span className="ml-auto font-normal normal-case text-slate-400">{count} hosts</span>
        )}
      </button>
    );
  }

  const menu = contextMenu && (
    <div
      ref={menuRef}
      role="menu"
      className="fixed z-50 w-40 rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-800"
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
        className="block w-full px-3 py-1.5 text-left text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300 dark:text-slate-200 dark:hover:bg-slate-700 dark:disabled:text-slate-600"
      >
        Connect
      </button>
      <button
        type="button"
        onClick={() => handleDuplicate(contextMenu.host)}
        className="block w-full px-3 py-1.5 text-left text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
      >
        Duplicate
      </button>
      <button
        type="button"
        onClick={() => {
          props.onEditHost(contextMenu.host);
          setContextMenu(null);
        }}
        className="block w-full px-3 py-1.5 text-left text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
      >
        Edit
      </button>
      <button
        type="button"
        onClick={() => handleDeleteHost(contextMenu.host)}
        className="block w-full px-3 py-1.5 text-left text-red-600 hover:bg-slate-100 dark:hover:bg-slate-700"
      >
        Delete
      </button>
    </div>
  );

  if (groups.length === 0 && hosts.length === 0) {
    return (
      <>
        <p className="px-2 py-4 text-sm text-slate-400">
          No hosts yet. Use "New host" above to add one.
        </p>
        {confirmDialog}
      </>
    );
  }

  const noSearchResults = query !== "" && !hosts.some(hostMatches);

  const favoriteHosts = hosts
    .filter((h) => h.is_favorite)
    .sort((a, b) => a.label.localeCompare(b.label));
  const recentHosts = hosts
    .filter((h) => h.last_connected_at)
    .sort((a, b) => (b.last_connected_at! < a.last_connected_at! ? -1 : 1))
    .slice(0, RECENT_LIMIT);

  return (
    <div>
      <input
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
        placeholder="Search hosts…"
        className="mx-2 mb-2 w-[calc(100%-1rem)] rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-teal-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      />
      {deleteError && (
        <p className="mx-2 mb-2 rounded-lg bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:bg-red-950 dark:text-red-400">
          {deleteError}
        </p>
      )}
      {query ? (
        noSearchResults ? (
          <p className="px-2 py-4 text-sm text-slate-400">No hosts match "{search.trim()}".</p>
        ) : (
          renderLevel(null, 0)
        )
      ) : (
        <>
          {favoriteHosts.length > 0 && (
            <div className="mb-1">
              <SectionHeader id="__favorites" label="Favorites" />
              {!collapsed.has("__favorites") && favoriteHosts.map((h) => renderHostRow(h, 0))}
            </div>
          )}
          {recentHosts.length > 0 && (
            <div className="mb-1">
              <SectionHeader id="__recent" label="Recent" />
              {!collapsed.has("__recent") && recentHosts.map((h) => renderHostRow(h, 0))}
            </div>
          )}
          <div>
            <SectionHeader id="__all" label="All Servers" count={hosts.length} />
            {!collapsed.has("__all") && renderLevel(null, 0)}
          </div>
        </>
      )}
      {menu}
      {confirmDialog}
    </div>
  );
}
