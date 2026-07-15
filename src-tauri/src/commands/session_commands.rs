use tauri::ipc::Channel;
use tauri::State;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::ssh::session::{self, SessionCommand, SessionEvent};
use crate::state::AppState;

#[tauri::command]
pub async fn session_connect(
    state: State<'_, AppState>,
    host_id: Uuid,
    on_event: Channel<SessionEvent>,
) -> AppResult<Uuid> {
    let sessions = state.sessions.clone();
    session::connect(&state, sessions, host_id, on_event).await
}

#[tauri::command]
pub fn session_write(state: State<AppState>, session_id: Uuid, data: String) -> AppResult<()> {
    let sender = state
        .sessions
        .get(&session_id)
        .ok_or(AppError::SessionNotFound)?;
    sender
        .send(SessionCommand::Write(data.into_bytes()))
        .map_err(|_| AppError::SessionNotFound)
}

#[tauri::command]
pub fn session_resize(
    state: State<AppState>,
    session_id: Uuid,
    cols: u32,
    rows: u32,
) -> AppResult<()> {
    let sender = state
        .sessions
        .get(&session_id)
        .ok_or(AppError::SessionNotFound)?;
    sender
        .send(SessionCommand::Resize { cols, rows })
        .map_err(|_| AppError::SessionNotFound)
}

#[tauri::command]
pub fn session_disconnect(state: State<AppState>, session_id: Uuid) -> AppResult<()> {
    let sender = state
        .sessions
        .get(&session_id)
        .ok_or(AppError::SessionNotFound)?;
    sender
        .send(SessionCommand::Close)
        .map_err(|_| AppError::SessionNotFound)
}
