use serde_json::{json, Value};

use crate::error::{AppError, AppResult};

use super::{format_tool_result, MessageInput, TurnResult, TOOL_DESCRIPTION, TOOL_NAME};

const ENDPOINT: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";
// Fixed rather than a real per-call id - see MessageInput's doc comment on
// why only one tool call is ever unresolved at a time in this model.
const TOOL_USE_ID: &str = "toolu_1";
const MAX_TOKENS: u32 = 1024;

pub async fn send(api_key: &str, model: &str, messages: &[MessageInput]) -> AppResult<TurnResult> {
    let mut wire_messages = Vec::new();
    for m in messages {
        match m {
            MessageInput::User { text } => {
                wire_messages.push(json!({ "role": "user", "content": text }));
            }
            MessageInput::Assistant { text, tool_call } => {
                let mut content = Vec::new();
                if let Some(text) = text {
                    if !text.is_empty() {
                        content.push(json!({ "type": "text", "text": text }));
                    }
                }
                if let Some(tc) = tool_call {
                    content.push(json!({
                        "type": "tool_use",
                        "id": TOOL_USE_ID,
                        "name": TOOL_NAME,
                        "input": { "command": tc.command, "purpose": tc.purpose },
                    }));
                }
                wire_messages.push(json!({ "role": "assistant", "content": content }));
            }
            MessageInput::ToolResult { command, output } => {
                wire_messages.push(json!({
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": TOOL_USE_ID,
                        "content": format_tool_result(command, output),
                    }],
                }));
            }
        }
    }

    let body = json!({
        "model": model,
        "max_tokens": MAX_TOKENS,
        "messages": wire_messages,
        "tools": [{
            "name": TOOL_NAME,
            "description": TOOL_DESCRIPTION,
            "input_schema": {
                "type": "object",
                "properties": {
                    "command": { "type": "string", "description": "The exact shell command to run." },
                    "purpose": { "type": "string", "description": "One sentence explaining what this command is for." },
                },
                "required": ["command", "purpose"],
            },
        }],
    });

    let resp = reqwest::Client::new()
        .post(ENDPOINT)
        .header("x-api-key", api_key)
        .header("anthropic-version", ANTHROPIC_VERSION)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Ai(format!("request to Anthropic failed: {e}")))?;

    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::Ai(format!("Anthropic returned an error: {text}")));
    }

    let value: Value = resp
        .json()
        .await
        .map_err(|e| AppError::Ai(format!("could not parse Anthropic's response: {e}")))?;
    let blocks = value
        .get("content")
        .and_then(|v| v.as_array())
        .ok_or_else(|| AppError::Ai("Anthropic's response had no content".into()))?;

    for block in blocks {
        if block.get("type").and_then(|v| v.as_str()) == Some("tool_use") {
            let command = block
                .pointer("/input/command")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let purpose = block
                .pointer("/input/purpose")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            return Ok(TurnResult::ToolCall { command, purpose });
        }
    }

    let text = blocks
        .iter()
        .filter_map(|b| {
            if b.get("type").and_then(|v| v.as_str()) == Some("text") {
                b.get("text").and_then(|v| v.as_str())
            } else {
                None
            }
        })
        .collect::<Vec<_>>()
        .join("\n");
    Ok(TurnResult::Text { text })
}
