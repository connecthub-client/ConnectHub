import { useEffect, useState } from "react";
import { Snippet } from "../../lib/tauri-bridge";
import { useSnippetsStore } from "../../state/snippetsStore";
import { useConfirm } from "../common/useConfirm";

interface SnippetsPanelProps {
  onNew: () => void;
  onEdit: (snippet: Snippet) => void;
  onRun: (snippet: Snippet) => void;
}

export default function SnippetsPanel({ onNew, onEdit, onRun }: SnippetsPanelProps) {
  const snippets = useSnippetsStore((s) => s.snippets);
  const loadSnippets = useSnippetsStore((s) => s.loadSnippets);
  const deleteSnippet = useSnippetsStore((s) => s.deleteSnippet);
  const { confirm, confirmDialog } = useConfirm();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    loadSnippets();
  }, [loadSnippets]);

  async function handleDelete(snippet: Snippet) {
    setDeleteError(null);
    if (await confirm(`Delete snippet "${snippet.label}"?`, { danger: true })) {
      try {
        await deleteSnippet(snippet.id);
      } catch (err) {
        setDeleteError(String(err));
      }
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div><h2 className="text-lg font-extrabold tracking-tight text-slate-900 dark:text-slate-50">Snippets</h2><p className="mt-0.5 text-xs text-slate-400">Reusable commands for one or many servers</p></div>
        <button
          type="button"
          onClick={onNew}
          className="rounded-xl bg-indigo-600 px-3 py-2 text-sm font-bold text-white shadow-sm shadow-indigo-600/20 hover:bg-indigo-700"
        >
          New snippet
        </button>
      </div>

      {deleteError && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-400">
          {deleteError}
        </p>
      )}

      {snippets.length === 0 ? (
        <p className="rounded-2xl border-2 border-dashed border-slate-200 px-4 py-10 text-center text-sm leading-6 text-slate-400 dark:border-slate-800">
          No snippets yet. Save a command once and run it on one or many hosts later.
        </p>
      ) : (
        <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
          {snippets.map((snippet) => (
            <div key={snippet.id} className="flex items-center justify-between gap-3 px-4 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/40">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  {snippet.label}
                </p>
                <p className="truncate font-mono text-xs text-slate-500 dark:text-slate-400">
                  {snippet.body}
                </p>
              </div>
              <div className="flex shrink-0 gap-3 text-sm">
                <button
                  type="button"
                  onClick={() => onRun(snippet)}
                  className="font-semibold text-indigo-600 hover:text-indigo-700"
                >
                  Run
                </button>
                <button
                  type="button"
                  onClick={() => onEdit(snippet)}
                  className="text-slate-500 hover:text-indigo-600"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(snippet)}
                  className="text-slate-500 hover:text-red-600"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {confirmDialog}
    </div>
  );
}
