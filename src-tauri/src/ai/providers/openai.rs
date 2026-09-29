use serde_json::{json, Value};

use crate::error::{AppError, AppResult};

use super::{format_tool_result, MessageInput, TurnResult, TOOL_DESCRIPTION, TOOL_NAME};

const ENDPOINT: &str = "https://api.openai.com/v1/chat/completions";
// Fixed rather than a real per-call id - see MessageInput's doc comment on
// why only one tool call is ever unresolved at a time in this model.
const TOOL_CALL_ID: &str = "call_1";

pub async fn send(api_key: &str, model: &str, messages: &[MessageInput]) -> AppResult<TurnResult> {
    let mut wire_messages = Vec::new();
    for m in messages {
        match m {
            MessageInput::User { text } => {
                wire_messages.push(json!({ "role": "user", "content": text }));
            }
            MessageInput::Assistant { text, tool_call } => match tool_call {
                Some(tc) => wire_messages.push(json!({
                    "role": "assistant",
                    "content": text,
                    "tool_calls": [{
                        "id": TOOL_CALL_ID,
                        "type": "function",
                        "function": {
                            "name": TOOL_NAME,
                            "arguments": serde_json::to_string(&json!({
                                "command": tc.command,
                                "purpose": tc.purpose,
                            })).unwrap_or_default(),
                        },
                    }],
                })),
                None => wire_messages.push(json!({ "role": "assistant", "content": text })),
            },
            MessageInput::ToolResult { command, output } => {
                wire_messages.push(json!({
                    "role": "tool",
                    "tool_call_id": TOOL_CALL_ID,
                    "content": format_tool_result(command, output),
                }));
            }
        }
    }

    let body = json!({
        "model": model,
        "messages": wire_messages,
        "tools": [{
            "type": "function",
            "function": {
                "name": TOOL_NAME,
                "description": TOOL_DESCRIPTION,
                "parameters": {
                    "type": "object",
                    "properties": {
                        "command": { "type": "string", "description": "The exact shell command to run." },
                        "purpose": { "type": "string", "description": "One sentence explaining what this command is for." },
                    },
                    "required": ["command", "purpose"],
                },
            },
        }],
    });

    let resp = reqwest::Client::new()
        .post(ENDPOINT)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Ai(format!("request to OpenAI failed: {e}")))?;

    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::Ai(format!("OpenAI returned an error: {text}")));
    }

    let value: Value = resp
        .json()
        .await
        .map_err(|e| AppError::Ai(format!("could not parse OpenAI's response: {e}")))?;
    let message = value
        .pointer("/choices/0/message")
        .ok_or_else(|| AppError::Ai("OpenAI's response had no choices".into()))?;

    if let Some(tool_calls) = message.get("tool_calls").and_then(|v| v.as_array()) {
        if let Some(first) = tool_calls.first() {
            let args_str = first
                .pointer("/function/arguments")
                .and_then(|v| v.as_str())
                .unwrap_or("{}");
            let args: Value = serde_json::from_str(args_str).map_err(|e| {
                AppError::Ai(format!("OpenAI returned malformed tool arguments: {e}"))
            })?;
            let command = args
                .get("command")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let purpose = args
                .get("purpose")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            return Ok(TurnResult::ToolCall { command, purpose });
        }
    }

    let text = message
        .get("content")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    Ok(TurnResult::Text { text })
}
