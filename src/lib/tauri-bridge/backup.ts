import { invoke } from "@tauri-apps/api/core";

export interface GoogleAuthStatus {
  connected: boolean;
  email: string | null;
}

export function googleStatus(): Promise<GoogleAuthStatus> {
  return invoke("google_status");
}

export function googleLogin(): Promise<GoogleAuthStatus> {
  return invoke("google_login");
}

export function googleLogout(): Promise<void> {
  return invoke("google_logout");
}

export function googleBackupNow(): Promise<void> {
  return invoke("google_backup_now");
}

export function googleRestore(): Promise<void> {
  return invoke("google_restore");
}
