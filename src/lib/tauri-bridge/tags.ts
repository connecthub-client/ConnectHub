import { invoke } from "@tauri-apps/api/core";
import { Tag } from "./types";

export function tagList(): Promise<Tag[]> {
  return invoke("tag_list");
}

// Get-or-create by label - safe to call for a label that might already
// exist (returns the existing tag unchanged) as well as a brand-new one.
export function tagCreate(label: string): Promise<Tag> {
  return invoke("tag_create", { label });
}

export function tagDelete(id: string): Promise<void> {
  return invoke("tag_delete", { id });
}
