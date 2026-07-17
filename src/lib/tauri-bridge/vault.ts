import { invoke } from "@tauri-apps/api/core";

export interface VaultStatus {
  initialized: boolean;
  unlocked: boolean;
}

export function vaultStatus(): Promise<VaultStatus> {
  return invoke("vault_status");
}

export function vaultCreate(password: string): Promise<void> {
  return invoke("vault_create", { password });
}

export function vaultUnlock(password: string): Promise<void> {
  return invoke("vault_unlock", { password });
}
