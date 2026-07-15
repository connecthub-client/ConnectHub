import { invoke } from "@tauri-apps/api/core";

export interface LocalEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: number | null;
}

export function localHomeDir(): Promise<string> {
  return invoke("local_home_dir");
}

export function localList(path: string): Promise<LocalEntry[]> {
  return invoke("local_list", { path });
}

export function localMkdir(path: string): Promise<void> {
  return invoke("local_mkdir", { path });
}

export function localRename(from: string, to: string): Promise<void> {
  return invoke("local_rename", { from, to });
}

export function localDelete(path: string, isDir: boolean): Promise<void> {
  return invoke("local_delete", { path, isDir });
}
