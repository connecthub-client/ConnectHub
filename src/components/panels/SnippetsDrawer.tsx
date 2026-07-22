import { Snippet } from "../../lib/tauri-bridge";
import SnippetsPanel from "./SnippetsPanel";

interface SnippetsDrawerProps {
  onNew: () => void;
  onEdit: (snippet: Snippet) => void;
  onRun: (snippet: Snippet) => void;
  onClose: () => void;
}

// A right-side drawer wrapping the existing, unmodified SnippetsPanel -
// takes over HostContextPanel's slot when open (see AppShell.tsx) rather
// than adding a 4th column, since the app's minimum width is tight.
export default function SnippetsDrawer({ onNew, onEdit, onRun, onClose }: SnippetsDrawerProps) {
  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
      <div className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-800">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-50">Snippets</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close snippets panel"
          className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800"
        >
          ✕
        </button>
      </div>
      <div className="flex-1 p-4">
        <SnippetsPanel onNew={onNew} onEdit={onEdit} onRun={onRun} />
      </div>
    </aside>
  );
}
