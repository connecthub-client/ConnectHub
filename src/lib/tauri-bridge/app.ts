import { invoke } from "@tauri-apps/api/core";

export function appVersion(): Promise<string> {
  return invoke("app_version");
}
