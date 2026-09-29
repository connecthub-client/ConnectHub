import { invoke } from "@tauri-apps/api/core";

export function appVersion(): Promise<string> {
  return invoke("app_version");
}

export type AppUpdateMethod = "native" | "deb" | "rpm" | "unsupported";

export function appUpdateMethod(): Promise<AppUpdateMethod> {
  return invoke("app_update_method");
}

export function appPackageUpdateInstall(version: string): Promise<void> {
  return invoke("app_package_update_install", { version });
}
