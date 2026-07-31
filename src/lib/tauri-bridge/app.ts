import { invoke } from "@tauri-apps/api/core";

export function appVersion(): Promise<string> {
  return invoke("app_version");
}

export function appUpdateInstallable(): Promise<boolean> {
  return invoke("app_update_installable");
}
