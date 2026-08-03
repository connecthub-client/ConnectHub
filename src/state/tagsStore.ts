import { create } from "zustand";
import * as bridge from "../lib/tauri-bridge";
import type { Tag } from "../lib/tauri-bridge";

interface TagsState {
  tags: Tag[];
  loaded: boolean;

  loadAll: () => Promise<void>;
  // Get-or-create: safe to call with a label that might already exist
  // (TagInput uses this both for "pick an existing tag" and "type a new
  // one" - the backend resolves which case it is).
  createTag: (label: string) => Promise<Tag>;
  deleteTag: (id: string) => Promise<void>;
}

// Same refetch-after-mutation convention as hostsStore.ts - the tag list is
// small, so simplicity wins over patching state in place.
export const useTagsStore = create<TagsState>((set, get) => ({
  tags: [],
  loaded: false,

  loadAll: async () => {
    const tags = await bridge.tagList();
    set({ tags, loaded: true });
  },

  createTag: async (label) => {
    const tag = await bridge.tagCreate(label);
    await get().loadAll();
    return tag;
  },
  deleteTag: async (id) => {
    await bridge.tagDelete(id);
    await get().loadAll();
  },
}));
