import { Host } from "../../lib/tauri-bridge";
import { useAiStore } from "../../state/aiStore";
import { useSettingsStore } from "../../state/settingsStore";
import AiChatPanel from "../ai/AiChatPanel";

interface AiAssistantDrawerProps {
  host: Host | null;
  onClose: () => void;
  onOpenSettings: () => void;
}

// Floats over the top-right of the terminal instead of sharing the docked
// right-panel slot (see AppShell.tsx) - the user wants to keep working in
// the terminal, including clicking into it, while this stays open, which a
// space-sharing docked panel can't do without shrinking it every time it's
// open. `right-16` clears the always-visible icon rail (AppShell.tsx's
// far-right `<nav>`, w-12) plus a small gap, so that rail's own toggle
// button is never covered by this panel. Deliberately no click-outside or
// Escape dismissal - only that toggle button opens/closes it, so clicking
// into (or typing in) the terminal underneath never closes it.
export default function AiAssistantDrawer({ host, onClose, onOpenSettings }: AiAssistantDrawerProps) {
  const aiActiveProvider = useSettingsStore((s) => s.aiActiveProvider);
  const clearConversation = useAiStore((s) => s.clearConversation);
  const hasMessages = useAiStore((s) => (host ? s.getConversation(host.id).messages.length > 0 : false));

  return (
    <aside className="fixed top-4 bottom-4 right-18 z-50 flex w-[25vw] min-w-80 max-w-120 flex-col overflow-hidden rounded-2xl border border-white/70 bg-white/95 shadow-2xl shadow-slate-950/25 backdrop-blur-xl dark:border-slate-700 dark:bg-slate-950/95">
      <div className="flex items-center justify-between border-b border-slate-200/50 p-4 dark:border-slate-800/50">
        <div><h2 className="text-base font-extrabold tracking-tight text-slate-900 dark:text-slate-50">AI Assistant</h2><p className="text-[11px] text-slate-400">Context-aware server help</p></div>
        <div className="flex items-center gap-1">
          {host && hasMessages && (
            <button
              type="button"
              onClick={() => clearConversation(host.id)}
              title="Clear this conversation"
              className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close AI Assistant panel"
            className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800"
          >
            ✕
          </button>
        </div>
      </div>
      {!host ? (
        <p className="p-4 text-sm text-slate-400">Select or connect to a server first.</p>
      ) : !aiActiveProvider ? (
        <div className="p-4 text-sm text-slate-400">
          <p className="mb-3">Connect an AI provider (OpenAI or Anthropic) to get started.</p>
          <button
            type="button"
            onClick={onOpenSettings}
            className="rounded-xl bg-indigo-600 px-3 py-2 text-sm font-bold text-white shadow-sm shadow-indigo-600/20 hover:bg-indigo-700"
          >
            Open Settings
          </button>
        </div>
      ) : (
        <AiChatPanel host={host} provider={aiActiveProvider} />
      )}
    </aside>
  );
}
