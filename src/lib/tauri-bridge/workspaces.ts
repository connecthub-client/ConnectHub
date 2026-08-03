import { invoke } from "@tauri-apps/api/core";
import { Workspace, WorkspaceTab, WorkspaceTabInput } from "./types";

export function workspaceList(): Promise<Workspace[]> {
  return invoke("workspace_list");
}

export function workspaceListTabs(workspaceId: string): Promise<WorkspaceTab[]> {
  return invoke("workspace_list_tabs", { workspaceId });
}

export function workspaceCreate(label: string, tabs: WorkspaceTabInput[]): Promise<Workspace> {
  return invoke("workspace_create", { label, tabs });
}

export function workspaceRename(id: string, label: string): Promise<Workspace> {
  return invoke("workspace_rename", { id, label });
}

export function workspaceDelete(id: string): Promise<void> {
  return invoke("workspace_delete", { id });
}
