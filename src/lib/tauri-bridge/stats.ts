import { invoke } from "@tauri-apps/api/core";
import { HostStats } from "./types";

export function hostStats(hostId: string): Promise<HostStats> {
  return invoke("host_stats", { hostId });
}
