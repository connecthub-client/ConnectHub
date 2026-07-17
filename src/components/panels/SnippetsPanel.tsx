import { useEffect } from "react";
import { Snippet } from "../../lib/tauri-bridge";
import { useSnippetsStore } from "../../state/snippetsStore";

interface SnippetsPanelProps {
  onNew: () => void;
  onEdit: (snippet: Snippet) => void;
  onRun: (snippet: Snippet) => void;
}

export default function SnippetsPanel({ onNew, onEdit, onRun }: SnippetsPanelProps) {
  const snippets = useSnippetsStore((s) => s.snippets);
  const loadSnippets = useSnippetsStore((s) => s.loadSnippets);
  const deleteSnippet = useSnippetsStore((s) => s.deleteSnippet);

  useEffect(() => {
    loadSnippets();
  }, [loadSnippets]);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">Snippets</h2>
        <button
          type="button"
          onClick={onNew}
          className="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700"
        >
          New snippet
        </button>
      </div>

      {snippets.length === 0 ? (
        <p className="text-sm text-neutral-400">
          No snippets yet. Save a command once and run it on one or many hosts later.
        </p>
      ) : (
        <div className="divide-y divide-neutral-200 rounded-md border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {snippets.map((snippet) => (
            <div key={snippet.id} className="flex items-center justify-between px-4 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  {snippet.label}
                </p>
                <p className="truncate font-mono text-xs text-neutral-500 dark:text-neutral-400">
                  {snippet.body}
                </p>
              </div>
              <div className="flex shrink-0 gap-3 text-sm">
                <button
                  type="button"
                  onClick={() => onRun(snippet)}
                  className="text-neutral-500 hover:text-teal-600"
                >
                  Run
                </button>
                <button
                  type="button"
                  onClick={() => onEdit(snippet)}
                  className="text-neutral-500 hover:text-teal-600"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Delete snippet "${snippet.label}"?`)) {
                      deleteSnippet(snippet.id);
                    }
                  }}
                  className="text-neutral-500 hover:text-red-600"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
