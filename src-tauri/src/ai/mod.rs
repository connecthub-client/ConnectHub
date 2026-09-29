// AI assistant: bring-your-own OpenAI/Anthropic API key, stored encrypted
// (see data::ai_settings, mirroring data::google_auth's pattern). Ties
// settings storage + provider dispatch together, called by thin commands
// - same role google::mod.rs plays for oauth.rs/drive.rs.
//
// Each call to send_turn is a single, stateless, independently-cancellable
// -at-the-JS-level round trip (one LLM call), exactly like every other
// command in this codebase - there is no long-lived Rust-side conversation
// loop. The frontend's aiStore.ts owns the multi-turn "ask -> maybe-run ->
// see-result -> ask-again" and "autonomous iterate" loops, resending the
// full message history on every turn; manual and autonomous mode are the
// same loop with a different confirmation policy, not two separate code
// paths.

pub mod guardrails;
pub mod providers;

use crate::data::ai_settings;
use crate::error::AppResult;
use crate::state::AppState;
use providers::{MessageInput, TurnResult};

pub struct AiSettingsStatus {
    pub openai_configured: bool,
    pub anthropic_configured: bool,
}

fn default_model(provider: &str) -> &'static str {
    match provider {
        "openai" => "gpt-4o-mini",
        "anthropic" => "claude-3-5-sonnet-latest",
        _ => "",
    }
}

pub fn status(state: &AppState) -> AppResult<AiSettingsStatus> {
    let conn = state.db.lock().unwrap();
    Ok(AiSettingsStatus {
        openai_configured: ai_settings::configured(&conn, "openai")?,
        anthropic_configured: ai_settings::configured(&conn, "anthropic")?,
    })
}

pub fn save_settings(
    state: &AppState,
    provider: &str,
    api_key: &str,
    model: Option<&str>,
) -> AppResult<()> {
    let conn = state.db.lock().unwrap();
    state.with_key(|key| ai_settings::set(&conn, key, provider, api_key, model))
}

pub fn clear_settings(state: &AppState, provider: &str) -> AppResult<()> {
    let conn = state.db.lock().unwrap();
    ai_settings::clear(&conn, provider)
}

pub async fn send_turn(
    state: &AppState,
    provider: &str,
    messages: Vec<MessageInput>,
) -> AppResult<TurnResult> {
    // The vault lock is dropped (this block ends) before the network call
    // below - never hold a std::sync::Mutex across an .await.
    let secret = {
        let conn = state.db.lock().unwrap();
        state.with_key(|key| ai_settings::get(&conn, key, provider))?
    };
    let secret = secret.ok_or_else(|| {
        crate::error::AppError::Ai(format!(
            "no API key configured for {provider} - add one in Settings"
        ))
    })?;
    let model = secret
        .model
        .unwrap_or_else(|| default_model(provider).to_string());
    providers::send(provider, &secret.api_key, &model, &messages).await
}
