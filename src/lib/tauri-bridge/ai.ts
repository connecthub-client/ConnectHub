import { invoke } from "@tauri-apps/api/core";
import { ExecOutput } from "./snippets";

export type AiProvider = "openai" | "anthropic";

// Mirrors src-tauri/src/ai/providers/mod.rs's MessageInput/TurnResult and
// commands/ai_commands.rs's AiCommandExecResult - each a serde
// `#[serde(tag = "...", rename_all = "snake_case")]` enum, which serializes
// as a plain discriminated object (e.g. `{"role":"user","text":"..."}`),
// not wrapped/tagged any other way.
export type AiMessageInput =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string | null; tool_call: { command: string; purpose: string } | null }
  | { role: "tool_result"; command: string; output: ExecOutput };

export type AiTurnResult =
  | { type: "text"; text: string }
  | { type: "tool_call"; command: string; purpose: string };

// Structural, not a thrown error - lets the caller distinguish "needs an
// explicit Run anyway click" from "the command actually failed" without
// string-matching an error message (Tauri command errors serialize to a
// plain string with no room for a discriminated "kind" tag).
export type AiCommandExecResult =
  | { type: "ran"; output: ExecOutput }
  | { type: "needs_confirmation"; pattern: string };

export interface AiSettingsStatus {
  openai_configured: boolean;
  anthropic_configured: boolean;
}

export function aiSettingsStatus(): Promise<AiSettingsStatus> {
  return invoke("ai_settings_status");
}

export function aiSettingsSet(provider: AiProvider, apiKey: string, model?: string): Promise<void> {
  return invoke("ai_settings_set", { provider, apiKey, model: model ?? null });
}

export function aiSettingsClear(provider: AiProvider): Promise<void> {
  return invoke("ai_settings_clear", { provider });
}

export function aiChatSend(provider: AiProvider, messages: AiMessageInput[]): Promise<AiTurnResult> {
  return invoke("ai_chat_send", { provider, messages });
}

export function aiCommandExec(
  hostId: string,
  command: string,
  overrideDenylist = false,
): Promise<AiCommandExecResult> {
  return invoke("ai_command_exec", { hostId, command, overrideDenylist });
}

// Same denylist check ai_command_exec makes, without running anything -
// for callers that want to run the command a different way (see
// aiStore.ts's live-terminal branch of runCommand) but still need the one
// authoritative gating decision first. Returns the matched pattern, or null
// if the command doesn't need confirmation.
export function aiCommandCheck(command: string): Promise<string | null> {
  return invoke("ai_command_check", { command });
}
