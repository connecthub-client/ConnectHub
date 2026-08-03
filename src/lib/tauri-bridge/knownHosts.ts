import { invoke } from "@tauri-apps/api/core";
import { KnownHost } from "./types";

export function knownHostsList(): Promise<KnownHost[]> {
  return invoke("known_hosts_list");
}

export function knownHostsDelete(hostname: string, port: number): Promise<void> {
  return invoke("known_hosts_delete", { hostname, port });
}
