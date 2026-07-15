import { useState } from "react";
import { Group, Host } from "../../lib/tauri-bridge";
import { useHostsStore } from "../../state/hostsStore";

interface HostTreeProps {
  selectedHostId: string | null;
  onSelectHost: (host: Host) => void;
  onEditGroup: (group: Group) => void;
  onEditHost: (host: Host) => void;
  onNewHost: (groupId: string | null) => void;
  onNewSubgroup: (parentId: string | null) => void;
}

export default function HostTree(props: HostTreeProps) {
  const groups = useHostsStore((s) => s.groups);
  const hosts = useHostsStore((s) => s.hosts);
  const deleteGroup = useHostsStore((s) => s.deleteGroup);
  const deleteHost = useHostsStore((s) => s.deleteHost);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

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
                  className="rounded px-1 text-xs text-neutral-500 hover:text-blue-600"
                >
                  +host
                </button>
                <button
                  type="button"
                  title="New subgroup"
                  onClick={() => props.onNewSubgroup(group.id)}
                  className="rounded px-1 text-xs text-neutral-500 hover:text-blue-600"
                >
                  +grp
                </button>
                <button
                  type="button"
                  title="Edit group"
                  onClick={() => props.onEditGroup(group)}
                  className="rounded px-1 text-xs text-neutral-500 hover:text-blue-600"
                >
                  edit
                </button>
                <button
                  type="button"
                  title="Delete group"
                  onClick={() => {
                    if (confirm(`Delete group "${group.name}"? Hosts inside become ungrouped.`)) {
                      deleteGroup(group.id);
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
              props.selectedHostId === host.id ? "bg-blue-50 dark:bg-blue-950" : ""
            }`}
            style={{ paddingLeft: `${depth * 16 + 24}px` }}
          >
            <button
              type="button"
              onClick={() => props.onSelectHost(host)}
              className="flex-1 text-left text-neutral-700 dark:text-neutral-300"
            >
              {host.label}
              <span className="ml-2 text-xs text-neutral-400">{host.hostname}</span>
            </button>
            <div className="hidden gap-1 group-hover:flex">
              <button
                type="button"
                title="Edit host"
                onClick={() => props.onEditHost(host)}
                className="rounded px-1 text-xs text-neutral-500 hover:text-blue-600"
              >
                edit
              </button>
              <button
                type="button"
                title="Delete host"
                onClick={() => {
                  if (confirm(`Delete host "${host.label}"?`)) {
                    deleteHost(host.id);
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

  if (groups.length === 0 && hosts.length === 0) {
    return (
      <p className="px-2 py-4 text-sm text-neutral-400">
        No hosts yet. Use "New host" above to add one.
      </p>
    );
  }

  return <div>{renderLevel(null, 0)}</div>;
}
