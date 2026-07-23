import { Group, Host } from "./tauri-bridge";

export interface GroupChildren {
  childGroups: Group[];
  childHosts: Host[];
}

// One level's worth of a group tree - the direct child groups and direct
// child hosts of `parentId` (null = root level), sorted the same way
// everywhere this is used (by sort_order, then name/label). Shared by
// HostTree.tsx (the sidebar) and the center Hosts grid so both render
// groups/hosts in the same order without duplicating this filter+sort.
export function getGroupChildren(groups: Group[], hosts: Host[], parentId: string | null): GroupChildren {
  const childGroups = groups
    .filter((g) => g.parent_id === parentId)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  const childHosts = hosts
    .filter((h) => h.group_id === parentId)
    .sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label));
  return { childGroups, childHosts };
}
