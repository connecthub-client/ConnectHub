import { invoke } from "@tauri-apps/api/core";
import { Group, GroupInput } from "./types";

export function groupList(): Promise<Group[]> {
  return invoke("group_list");
}

export function groupCreate(input: GroupInput): Promise<Group> {
  return invoke("group_create", { input });
}

export function groupUpdate(id: string, input: GroupInput): Promise<Group> {
  return invoke("group_update", { id, input });
}

export function groupDelete(id: string): Promise<void> {
  return invoke("group_delete", { id });
}
