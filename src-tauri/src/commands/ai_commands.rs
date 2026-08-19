use serde::Serialize;
use tauri::State;
use uuid::Uuid;

use crate::ai::providers::{MessageInput, TurnResult};
use crate::ai::{self, guardrails};
use crate::error::AppResult;
use crate::ssh::exec::{self, ExecOutput};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
pub struct AiSettingsStatusResponse {
    pub openai_configured: bool,
    pub anthropic_configured: bool,
}

#[tauri::command]
pub fn ai_settings_status(state: State<AppState>) -> AppResult<AiSettingsStatusResponse> {
    let status = ai::status(&state)?;
    Ok(AiSettingsStatusResponse {
        openai_configured: status.openai_configured,
        anthropic_configured: status.anthropic_configured,
    })
}

#[tauri::command]
pub fn ai_settings_set(
    state: State<AppState>,
    provider: String,
    api_key: String,
    model: Option<String>,
) -> AppResult<()> {
    ai::save_settings(&state, &provider, &api_key, model.as_deref())
}

#[tauri::command]
pub fn ai_settings_clear(state: State<AppState>, provider: String) -> AppResult<()> {
    ai::clear_settings(&state, &provider)
}

#[tauri::command]
pub async fn ai_chat_send(
    state: State<'_, AppState>,
    provider: String,
    messages: Vec<MessageInput>,
) -> AppResult<TurnResult> {
    ai::send_turn(&state, &provider, messages).await
}

// Not a thrown error for the denylist case - the frontend distinguishes
// this from a real failure structurally rather than string-matching an
// AppError's message, since command errors serialize to a plain string
// with no room for a discriminated "kind" tag.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AiCommandExecResult {
    Ran { output: ExecOutput },
    NeedsConfirmation { pattern: String },
}

#[tauri::command]
pub async fn ai_command_exec(
    state: State<'_, AppState>,
    host_id: Uuid,
    command: String,
    override_denylist: bool,
) -> AppResult<AiCommandExecResult> {
    if !override_denylist {
        if let Some(pattern) = guardrails::denylist_match(&command) {
            return Ok(AiCommandExecResult::NeedsConfirmation { pattern: pattern.to_string() });
        }
    }
    let output = exec::run_capped(&state, host_id, command, guardrails::MAX_OUTPUT_BYTES).await?;
    Ok(AiCommandExecResult::Ran { output })
}

// Same denylist check as ai_command_exec, without executing anything - lets
// a caller that's about to run the command a different way (e.g. writing it
// into an already-open terminal session instead of this module's own exec
// channel) still go through the one authoritative Rust-side check first,
// rather than either skipping it or executing the command twice to get a
// gating decision.
#[tauri::command]
pub fn ai_command_check(command: String) -> Option<String> {
    guardrails::denylist_match(&command).map(|pattern| pattern.to_string())
}
