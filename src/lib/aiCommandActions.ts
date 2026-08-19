import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { sessionWrite } from "./tauri-bridge";

// Same utility TerminalView.tsx's own terminal copy uses - best-effort, same
// as that call site, since a failed clipboard write here isn't worth
// surfacing as an error to the user.
export async function copyCommandText(text: string): Promise<void> {
  try {
    await writeText(text);
  } catch {
    // best-effort
  }
}

// Mirrors HostContextPanel.tsx's Quick Commands Auto-Run-OFF branch:
// inserts the text into the terminal's input line without submitting it
// (deliberately no trailing "\r"), so the user can review/edit/submit it
// themselves rather than it running immediately.
export function pasteCommandToTerminal(sessionId: string, text: string): Promise<void> {
  return sessionWrite(sessionId, text);
}
