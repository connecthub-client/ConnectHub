import { invoke } from "@tauri-apps/api/core";

export type TunnelKind = "local" | "remote" | "dynamic";

export interface TunnelInput {
  host_id: string;
  kind: TunnelKind;
  bind_address: string;
  bind_port: number;
  target_host: string | null;
  target_port: number | null;
}

export interface TunnelInfo {
  id: string;
  host_id: string;
  kind: TunnelKind;
  bind_address: string;
  bind_port: number;
  target_host: string | null;
  target_port: number | null;
}

export function tunnelStart(input: TunnelInput): Promise<string> {
  return invoke("tunnel_start", { input });
}

export function tunnelStop(tunnelId: string): Promise<void> {
  return invoke("tunnel_stop", { tunnelId });
}

export function tunnelList(): Promise<TunnelInfo[]> {
  return invoke("tunnel_list");
}
