import { useState } from "react";
import { AiMode } from "../../state/aiStore";
import { useConfirm } from "../common/useConfirm";

interface AiInputBoxProps {
  mode: AiMode;
  running: boolean;
  // True while the last message is a still-unresolved proposed command (see
  // aiStore.ts's hasPendingToolCall) - sending a new message in that state
  // would leave it dangling in the history sent to the provider on the next
  // turn, which every provider's API rejects. Blocked here rather than only
  // in the store so the input visibly explains why, instead of silently
  // doing nothing on Send.
  pendingToolCall: boolean;
  onSend: (text: string) => void;
  onModeChange: (mode: AiMode) => void;
  onStop: () => void;
}

export default function AiInputBox({ mode, running, pendingToolCall, onSend, onModeChange, onStop }: AiInputBoxProps) {
  const [text, setText] = useState("");
  const { confirm, confirmDialog } = useConfirm();
  const disabled = running || pendingToolCall;

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText("");
  }

  async function handleModeToggle() {
    // A one-time (per click, not persisted) disclaimer rather than a
    // silent mode flip - switching to autonomous is the one action in
    // this feature that changes what happens without a click per step.
    // Must be useConfirm, not window.confirm() - see that hook's own
    // comment: the native dialog breaks theme, and in this app's Tauri/
    // WebKitGTK webview it doesn't even reliably show at all, silently
    // resolving truthy instead of pausing for the disclaimer.
    if (mode === "ask") {
      const confirmed = await confirm(
        "Autonomous mode lets the AI run commands on this server on its own, without asking first for each one. Commands matching an obviously destructive pattern still always pause for confirmation. Continue?",
        { title: "Switch to Autonomous mode?", confirmLabel: "Switch to Autonomous" },
      );
      if (!confirmed) return;
      onModeChange("autonomous");
      return;
    }
    onModeChange("ask");
  }

  return (
    <div className="border-t border-slate-200 p-3 dark:border-slate-800">
      {confirmDialog}
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={handleModeToggle}
          title={
            mode === "autonomous"
              ? "Autonomous: runs proposed commands on its own (destructive-looking ones still pause). Click to switch to Ask."
              : "Ask: every proposed command needs a manual Run click. Click to switch to Autonomous."
          }
          className={`rounded-md px-2 py-1 text-xs font-medium ${
            mode === "autonomous"
              ? "bg-amber-500 text-white"
              : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
          }`}
        >
          {mode === "autonomous" ? "Autonomous mode" : "Ask mode"}
        </button>
        {running && (
          <button
            type="button"
            onClick={onStop}
            className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"
          >
            Stop
          </button>
        )}
      </div>
      <div className="flex gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={
            pendingToolCall
              ? "Run or skip the proposed command above first…"
              : mode === "autonomous"
                ? "Describe a goal…"
                : "Ask about this server…"
          }
          rows={2}
          disabled={disabled}
          className="flex-1 resize-none rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 outline-none focus:border-teal-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
        <button
          type="button"
          onClick={submit}
          disabled={disabled || !text.trim()}
          className="self-end rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}
