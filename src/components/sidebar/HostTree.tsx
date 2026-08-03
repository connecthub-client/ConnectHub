import { useEffect, useState } from "react";
import { Group, Host } from "../../lib/tauri-bridge";
import { getGroupChildren } from "../../lib/groupTree";
import { useHostsStore } from "../../state/hostsStore";
import { useSessionsStore } from "../../state/sessionsStore";
import { useConfirm } from "../common/useConfirm";
import { useHostContextMenu } from "../common/useHostContextMenu";
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

const RECENT_LIMIT = 5;

export default function HostTree(props: HostTreeProps) {
  const groups = useHostsStore((s) => s.groups);
  const hosts = useHostsStore((s) => s.hosts);
  const deleteGroup = useHostsStore((s) => s.deleteGroup);
  const toggleHostFavorite = useHostsStore((s) => s.toggleHostFavorite);
  const openSessions = useSessionsStore((s) => s.openSessions);
  const openHostIds = new Set(openSessions.map((s) => s.host.id));
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const [tagFilter, setTagFilter] = useState<Set<string>>(new Set());
  // Only tags actually assigned to at least one host - an unused tag
  // (e.g. one someone created via TagInput then removed again) shouldn't
  // clutter this filter row.
  const usedTags = Array.from(
    new Map(hosts.flatMap((h) => h.tags).map((t) => [t.id, t])).values(),
  ).sort((a, b) => a.label.localeCompare(b.label));

  // If a tag stops being used by any host (its last host was deleted, or
  // untagged) while it's an active filter, drop it from the filter too -
  // otherwise the chip that would let the user clear it disappears from
  // this same list, leaving the tree stuck on "no hosts match" with no way
  // back short of a page reload.
  useEffect(() => {
    const usedIds = new Set(hosts.flatMap((h) => h.tags).map((t) => t.id));
    setTagFilter((prev) => {
      const next = new Set([...prev].filter((id) => usedIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [hosts]);

  function toggleTagFilter(id: string) {
    setTagFilter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const { confirm, confirmDialog: groupConfirmDialog } = useConfirm();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const {
    openContextMenu,
    menu,
    confirmDialog: hostConfirmDialog,
    deleteError: hostDeleteError,
    handleDeleteHost,
  } = useHostContextMenu(props.onConnectHost, props.onEditHost);

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Only touches real group ids, leaving the Favorites/Recent/All Servers
  // section headers' own collapse state untouched (those share the same
  // `collapsed` set via synthetic ids, but aren't what "every group" means
  // here).
  function expandAllGroups() {
    setCollapsed((prev) => {
      const next = new Set(prev);
      groups.forEach((g) => next.delete(g.id));
      return next;
    });
  }

  function collapseAllGroups() {
    setCollapsed((prev) => {
      const next = new Set(prev);
      groups.forEach((g) => next.add(g.id));
      return next;
    });
  }

  const isFiltering = query !== "" || tagFilter.size > 0;

  function hostMatches(host: Host): boolean {
    if (!isFiltering) return true;
    const textOk =
      !query ||
      host.label.toLowerCase().includes(query) ||
      host.hostname.toLowerCase().includes(query) ||
      host.tags.some((t) => t.label.toLowerCase().includes(query));
    const tagOk = tagFilter.size === 0 || host.tags.some((t) => tagFilter.has(t.id));
    return textOk && tagOk;
  }

  // A group is worth showing while filtering if any host anywhere inside
  // it (directly, or inside a nested subgroup) matches - otherwise a
  // matching host several levels deep would have every ancestor group
  // filtered out along with it.
  function groupHasMatch(groupId: string): boolean {
    if (!isFiltering) return true;
    if (hosts.some((h) => h.group_id === groupId && hostMatches(h))) return true;
    return groups.some((g) => g.parent_id === groupId && groupHasMatch(g.id));
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
            openContextMenu(host, e);
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
    const { childGroups: allChildGroups, childHosts: allChildHosts } = getGroupChildren(groups, hosts, parentId);
    const childGroups = allChildGroups.filter((g) => groupHasMatch(g.id));
    const childHosts = allChildHosts.filter(hostMatches);

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
                  {!isFiltering && collapsed.has(group.id) ? "▸" : "▾"}
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
            {(isFiltering || !collapsed.has(group.id)) && renderLevel(group.id, depth + 1)}
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

  if (groups.length === 0 && hosts.length === 0) {
    return (
      <>
        <p className="px-2 py-4 text-sm text-slate-400">
          No hosts yet. Use "New host" above to add one.
        </p>
        {groupConfirmDialog}
        {hostConfirmDialog}
      </>
    );
  }

  const noFilterResults = isFiltering && !hosts.some(hostMatches);

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
      {usedTags.length > 0 && (
        <div className="mx-2 mb-2 flex flex-wrap gap-1">
          {usedTags.map((tag) => (
            <button
              key={tag.id}
              type="button"
              onClick={() => toggleTagFilter(tag.id)}
              className={`rounded-full border px-2 py-0.5 text-xs ${
                tagFilter.has(tag.id)
                  ? "border-teal-500 bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300"
                  : "border-slate-300 text-slate-500 hover:border-slate-400 dark:border-slate-700 dark:text-slate-400"
              }`}
            >
              {tag.label}
            </button>
          ))}
        </div>
      )}
      {groups.length > 0 && (
        <div className="mx-2 mb-2 flex gap-2 text-xs">
          <button
            type="button"
            onClick={expandAllGroups}
            className="flex-1 rounded-lg border border-slate-300 px-2 py-1 font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Expand all
          </button>
          <button
            type="button"
            onClick={collapseAllGroups}
            className="flex-1 rounded-lg border border-slate-300 px-2 py-1 font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Collapse all
          </button>
        </div>
      )}
      {(deleteError || hostDeleteError) && (
        <p className="mx-2 mb-2 rounded-lg bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:bg-red-950 dark:text-red-400">
          {deleteError || hostDeleteError}
        </p>
      )}
      {isFiltering ? (
        noFilterResults ? (
          <p className="px-2 py-4 text-sm text-slate-400">
            {query ? `No hosts match "${search.trim()}".` : "No hosts match the selected tags."}
          </p>
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
      {groupConfirmDialog}
      {hostConfirmDialog}
    </div>
  );
}
