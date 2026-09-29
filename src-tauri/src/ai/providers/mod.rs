use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::ssh::exec::ExecOutput;

pub mod anthropic;
pub mod openai;

// The one tool exposed to every provider - this is what turns "suggest a
// command" into a structured tool call instead of scraping text out of a
// markdown fence, and is exactly what the autonomous loop on the frontend
// also reuses (same tool, auto-executed instead of click-gated per call).
pub const TOOL_NAME: &str = "run_shell_command";
pub const TOOL_DESCRIPTION: &str = "Run a shell command on the connected server and see its output. \
     Use this whenever running a command would help answer the question or make progress on the stated goal.";

// One turn of conversation history, provider-agnostic - each provider
// module translates this into its own wire format from scratch on every
// call (see the module-level note in ai/mod.rs on why this is stateless
// per turn rather than a persistent server-side conversation). Only one
// tool call is ever unresolved at a time by construction (a ToolResult
// always follows the Assistant message that proposed it before the next
// turn is requested), so provider modules can use a fixed placeholder
// tool-call id instead of needing a real one threaded through here.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "role", rename_all = "snake_case")]
pub enum MessageInput {
    User {
        text: String,
    },
    Assistant {
        text: Option<String>,
        tool_call: Option<ToolCallInput>,
    },
    ToolResult {
        command: String,
        output: ExecOutput,
    },
}

#[derive(Debug, Clone, Deserialize)]
pub struct ToolCallInput {
    pub command: String,
    pub purpose: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TurnResult {
    Text { text: String },
    ToolCall { command: String, purpose: String },
}

pub async fn send(
    provider: &str,
    api_key: &str,
    model: &str,
    messages: &[MessageInput],
) -> AppResult<TurnResult> {
    match provider {
        "openai" => openai::send(api_key, model, messages).await,
        "anthropic" => anthropic::send(api_key, model, messages).await,
        other => Err(AppError::Ai(format!("unknown AI provider: {other}"))),
    }
}

// Shared plain-text rendering of a tool result, used by both provider
// modules (each still wraps it in their own wire format - OpenAI's a plain
// "tool" message string, Anthropic's a tool_result content block string).
pub fn format_tool_result(command: &str, output: &ExecOutput) -> String {
    let mut out = format!("$ {command}\n");
    if !output.stdout.is_empty() {
        out.push_str(&output.stdout);
        if !output.stdout.ends_with('\n') {
            out.push('\n');
        }
    }
    if !output.stderr.is_empty() {
        out.push_str("[stderr]\n");
        out.push_str(&output.stderr);
        if !output.stderr.ends_with('\n') {
            out.push('\n');
        }
    }
    let status = output
        .exit_status
        .map(|c| c.to_string())
        .unwrap_or_else(|| "unknown".into());
    out.push_str(&format!("[exit status: {status}]"));
    if output.truncated {
        out.push_str("\n[output truncated - only the first portion is shown]");
    }
    out
}
