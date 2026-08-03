import { create } from "zustand";
import * as bridge from "../lib/tauri-bridge";
import type { Workspace, WorkspaceTab, WorkspaceTabInput } from "../lib/tauri-bridge";

interface WorkspacesState {
  workspaces: Workspace[];
  loaded: boolean;

  loadAll: () => Promise<void>;
  // "Save current layout" - AppShell.tsx captures the tab list from
  // sessionsStore and passes it in; this store has no visibility into live
  // session state itself.
  createWorkspace: (label: string, tabs: WorkspaceTabInput[]) => Promise<Workspace>;
  renameWorkspace: (id: string, label: string) => Promise<Workspace>;
  deleteWorkspace: (id: string) => Promise<void>;
  // Fetched on demand (not kept in this store's state) - only needed
  // transiently when AppShell.tsx opens a workspace.
  listTabs: (workspaceId: string) => Promise<WorkspaceTab[]>;
}

// Same refetch-after-mutation convention as every other store (hostsStore.ts,
// tagsStore.ts) - the workspace list is small, so simplicity wins over
// patching state in place.
export const useWorkspacesStore = create<WorkspacesState>((set, get) => ({
  workspaces: [],
  loaded: false,

  loadAll: async () => {
    const workspaces = await bridge.workspaceList();
    set({ workspaces, loaded: true });
  },

  createWorkspace: async (label, tabs) => {
    const workspace = await bridge.workspaceCreate(label, tabs);
    await get().loadAll();
    return workspace;
  },
  renameWorkspace: async (id, label) => {
    const workspace = await bridge.workspaceRename(id, label);
    await get().loadAll();
    return workspace;
  },
  deleteWorkspace: async (id) => {
    await bridge.workspaceDelete(id);
    await get().loadAll();
  },
  listTabs: (workspaceId) => bridge.workspaceListTabs(workspaceId),
}));
