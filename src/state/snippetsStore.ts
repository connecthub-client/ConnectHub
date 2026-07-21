import { create } from "zustand";
import {
  HostExecResult,
  Snippet,
  SnippetInput,
  snippetCreate,
  snippetDelete,
  snippetList,
  snippetRunOnHosts,
  snippetUpdate,
} from "../lib/tauri-bridge";

interface SnippetsState {
  snippets: Snippet[];
  loadSnippets: () => Promise<void>;
  createSnippet: (input: SnippetInput) => Promise<Snippet>;
  updateSnippet: (id: string, input: SnippetInput) => Promise<Snippet>;
  deleteSnippet: (id: string) => Promise<void>;
  runOnHosts: (hostIds: string[], command: string) => Promise<HostExecResult[]>;
}

// Guards against overlapping loadSnippets() calls (e.g. two mutations in
// quick succession) resolving out of order and overwriting fresher state
// with a stale snapshot - same reasoning as hostsStore's loadRequestId.
let loadRequestId = 0;

export const useSnippetsStore = create<SnippetsState>((set, get) => ({
  snippets: [],

  loadSnippets: async () => {
    const requestId = ++loadRequestId;
    const snippets = await snippetList();
    if (requestId !== loadRequestId) return;
    set({ snippets });
  },

  createSnippet: async (input) => {
    const snippet = await snippetCreate(input);
    await get().loadSnippets();
    return snippet;
  },

  updateSnippet: async (id, input) => {
    const snippet = await snippetUpdate(id, input);
    await get().loadSnippets();
    return snippet;
  },

  deleteSnippet: async (id) => {
    await snippetDelete(id);
    await get().loadSnippets();
  },

  runOnHosts: (hostIds, command) => snippetRunOnHosts(hostIds, command),
}));
