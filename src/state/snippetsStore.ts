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

export const useSnippetsStore = create<SnippetsState>((set, get) => ({
  snippets: [],

  loadSnippets: async () => {
    const snippets = await snippetList();
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
