import { Channel, invoke } from "@tauri-apps/api/core";

export type SessionEvent =
  | { type: "data"; data: string }
  | { type: "closed" }
  | { type: "error"; message: string };

export function sessionConnect(
  hostId: string,
  onEvent: (event: SessionEvent) => void,
): Promise<string> {
  const channel = new Channel<SessionEvent>();
  channel.onmessage = onEvent;
  return invoke("session_connect", { hostId, onEvent: channel });
}

export function sessionWrite(sessionId: string, data: string): Promise<void> {
  return invoke("session_write", { sessionId, data });
}

export function sessionResize(sessionId: string, cols: number, rows: number): Promise<void> {
  return invoke("session_resize", { sessionId, cols, rows });
}

export function sessionDisconnect(sessionId: string): Promise<void> {
  return invoke("session_disconnect", { sessionId });
}
