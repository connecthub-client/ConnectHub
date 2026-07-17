import { invoke } from "@tauri-apps/api/core";

export function vaultAutoUnlock(): Promise<void> {
  return invoke("vault_auto_unlock");
}
