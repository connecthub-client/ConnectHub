import { invoke } from "@tauri-apps/api/core";
import { GenerateKeyInput, ImportKeyInput, SshKey } from "./types";

export function keyList(): Promise<SshKey[]> {
  return invoke("key_list");
}

export function keyGenerate(input: GenerateKeyInput): Promise<SshKey> {
  return invoke("key_generate", { input });
}

export function keyImport(input: ImportKeyInput): Promise<SshKey> {
  return invoke("key_import", { input });
}

export function keyDelete(id: string): Promise<void> {
  return invoke("key_delete", { id });
}
