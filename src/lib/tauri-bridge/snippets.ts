import { invoke } from "@tauri-apps/api/core";

export interface Snippet {
  id: string;
  label: string;
  body: string;
}

export interface SnippetInput {
  label: string;
  body: string;
}

export interface ExecOutput {
  stdout: string;
  stderr: string;
  exit_status: number | null;
}

export interface HostExecResult {
  host_id: string;
  output: ExecOutput | null;
  error: string | null;
}

export function snippetList(): Promise<Snippet[]> {
  return invoke("snippet_list");
}

export function snippetCreate(input: SnippetInput): Promise<Snippet> {
  return invoke("snippet_create", { input });
}

export function snippetUpdate(id: string, input: SnippetInput): Promise<Snippet> {
  return invoke("snippet_update", { id, input });
}

export function snippetDelete(id: string): Promise<void> {
  return invoke("snippet_delete", { id });
}

export function snippetRunOnHosts(hostIds: string[], command: string): Promise<HostExecResult[]> {
  return invoke("snippet_run_on_hosts", { hostIds, command });
}
