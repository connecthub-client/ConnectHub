import { invoke } from "@tauri-apps/api/core";
import { Identity, IdentityInput } from "./types";

export function identityList(): Promise<Identity[]> {
  return invoke("identity_list");
}

export function identityCreate(input: IdentityInput): Promise<Identity> {
  return invoke("identity_create", { input });
}

export function identityUpdate(id: string, input: IdentityInput): Promise<Identity> {
  return invoke("identity_update", { id, input });
}

export function identityDelete(id: string): Promise<void> {
  return invoke("identity_delete", { id });
}
