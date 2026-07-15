import { invoke } from "@tauri-apps/api/core";
import { Host, HostInput } from "./types";

export function hostList(): Promise<Host[]> {
  return invoke("host_list");
}

export function hostCreate(input: HostInput): Promise<Host> {
  return invoke("host_create", { input });
}

export function hostUpdate(id: string, input: HostInput): Promise<Host> {
  return invoke("host_update", { id, input });
}

export function hostDelete(id: string): Promise<void> {
  return invoke("host_delete", { id });
}
