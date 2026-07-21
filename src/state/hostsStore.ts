import { create } from "zustand";
import * as bridge from "../lib/tauri-bridge";
import type {
  Group,
  GroupInput,
  Host,
  HostInput,
  Identity,
  IdentityInput,
  ImportSummary,
  SshKey,
  GenerateKeyInput,
  ImportKeyInput,
} from "../lib/tauri-bridge";

interface HostsState {
  groups: Group[];
  hosts: Host[];
  identities: Identity[];
  keys: SshKey[];
  loaded: boolean;

  loadAll: () => Promise<void>;

  createGroup: (input: GroupInput) => Promise<Group>;
  updateGroup: (id: string, input: GroupInput) => Promise<Group>;
  deleteGroup: (id: string) => Promise<void>;

  createHost: (input: HostInput) => Promise<Host>;
  updateHost: (id: string, input: HostInput) => Promise<Host>;
  deleteHost: (id: string) => Promise<void>;
  exportHostsCsv: () => Promise<string>;
  importHostsCsv: (content: string) => Promise<ImportSummary>;

  createIdentity: (input: IdentityInput) => Promise<Identity>;
  updateIdentity: (id: string, input: IdentityInput) => Promise<Identity>;
  deleteIdentity: (id: string) => Promise<void>;

  generateKey: (input: GenerateKeyInput) => Promise<SshKey>;
  importKey: (input: ImportKeyInput) => Promise<SshKey>;
  deleteKey: (id: string) => Promise<void>;
}

// Mutations refetch the full collection set afterward rather than patching
// state in place - the dataset is small (a personal host list) and this
// avoids subtle bugs from the backend's ON DELETE SET NULL cascades.
//
// Every mutation below calls loadAll() independently, so two overlapping
// ones (e.g. duplicating a host twice in quick succession, or editing one
// while a delete is still in flight) fire overlapping loadAll() calls with
// no guarantee they resolve in the order they started. loadRequestId
// tracks which call is the most recent; a call whose response comes back
// after a newer one has already started is discarded instead of
// overwriting fresher state with a stale snapshot.
let loadRequestId = 0;

export const useHostsStore = create<HostsState>((set, get) => ({
  groups: [],
  hosts: [],
  identities: [],
  keys: [],
  loaded: false,

  loadAll: async () => {
    const requestId = ++loadRequestId;
    const [groups, hosts, identities, keys] = await Promise.all([
      bridge.groupList(),
      bridge.hostList(),
      bridge.identityList(),
      bridge.keyList(),
    ]);
    if (requestId !== loadRequestId) return;
    set({ groups, hosts, identities, keys, loaded: true });
  },

  createGroup: async (input) => {
    const group = await bridge.groupCreate(input);
    await get().loadAll();
    return group;
  },
  updateGroup: async (id, input) => {
    const group = await bridge.groupUpdate(id, input);
    await get().loadAll();
    return group;
  },
  deleteGroup: async (id) => {
    await bridge.groupDelete(id);
    await get().loadAll();
  },

  createHost: async (input) => {
    const host = await bridge.hostCreate(input);
    await get().loadAll();
    return host;
  },
  updateHost: async (id, input) => {
    const host = await bridge.hostUpdate(id, input);
    await get().loadAll();
    return host;
  },
  deleteHost: async (id) => {
    await bridge.hostDelete(id);
    await get().loadAll();
  },
  exportHostsCsv: () => bridge.hostExportCsv(),
  importHostsCsv: async (content) => {
    const summary = await bridge.hostImportCsv(content);
    await get().loadAll();
    return summary;
  },

  createIdentity: async (input) => {
    const identity = await bridge.identityCreate(input);
    await get().loadAll();
    return identity;
  },
  updateIdentity: async (id, input) => {
    const identity = await bridge.identityUpdate(id, input);
    await get().loadAll();
    return identity;
  },
  deleteIdentity: async (id) => {
    await bridge.identityDelete(id);
    await get().loadAll();
  },

  generateKey: async (input) => {
    const key = await bridge.keyGenerate(input);
    await get().loadAll();
    return key;
  },
  importKey: async (input) => {
    const key = await bridge.keyImport(input);
    await get().loadAll();
    return key;
  },
  deleteKey: async (id) => {
    await bridge.keyDelete(id);
    await get().loadAll();
  },
}));
