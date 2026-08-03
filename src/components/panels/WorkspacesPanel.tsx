import { useState } from "react";
import { Workspace } from "../../lib/tauri-bridge";
import { useWorkspacesStore } from "../../state/workspacesStore";
import { useConfirm } from "../common/useConfirm";
import { usePrompt } from "../common/usePrompt";

interface WorkspacesPanelProps {
  // Whether there's anything open right now worth saving - the panel
  // itself has no visibility into sessionsStore, so AppShell.tsx decides.
  hasOpenSessions: boolean;
  onSaveCurrentLayout: (label: string) => Promise<void>;
  onOpen: (workspace: Workspace) => Promise<void>;
}

// A workspace is an on-demand, named snapshot of which tabs (and how many
// panes each) were open - saved once via "Save current layout", reopened
// later via "Open". Not an auto-restored session (see ARCHITECTURE notes on
// why that's a deliberately separate, larger feature this doesn't attempt).
export default function WorkspacesPanel({ hasOpenSessions, onSaveCurrentLayout, onOpen }: WorkspacesPanelProps) {
  const workspaces = useWorkspacesStore((s) => s.workspaces);
  const renameWorkspace = useWorkspacesStore((s) => s.renameWorkspace);
  const deleteWorkspace = useWorkspacesStore((s) => s.deleteWorkspace);
  const [error, setError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const { prompt, promptDialog } = usePrompt();
  const { confirm, confirmDialog } = useConfirm();

  async function handleSave() {
    const label = await prompt("Save current layout as:", "My workspace");
    if (!label) return;
    setError(null);
    try {
      await onSaveCurrentLayout(label);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleOpen(workspace: Workspace) {
    setError(null);
    setOpeningId(workspace.id);
    try {
      await onOpen(workspace);
    } catch (e) {
      setError(String(e));
    } finally {
      setOpeningId(null);
    }
  }

  async function handleRename(workspace: Workspace) {
    const label = await prompt("Rename workspace:", workspace.label);
    if (!label || label === workspace.label) return;
    setError(null);
    try {
      await renameWorkspace(workspace.id, label);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleDelete(workspace: Workspace) {
    if (!(await confirm(`Delete workspace "${workspace.label}"?`, { danger: true }))) return;
    setError(null);
    try {
      await deleteWorkspace(workspace.id);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Workspaces</h2>
        <button
          type="button"
          onClick={handleSave}
          disabled={!hasOpenSessions}
          title={hasOpenSessions ? undefined : "Open at least one tab first"}
          className="rounded-md bg-teal-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-teal-700 disabled:opacity-50"
        >
          Save current layout
        </button>
      </div>
      {error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-400">
          {error}
        </p>
      )}
      {workspaces.length === 0 ? (
        <p className="text-sm text-slate-400">
          No saved workspaces yet. Open some hosts, then "Save current layout" to name and save
          this arrangement for later.
        </p>
      ) : (
        <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          {workspaces.map((workspace) => (
            <div key={workspace.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-800 dark:text-slate-200">{workspace.label}</p>
                <p className="text-xs text-slate-400">
                  {workspace.tab_count} tab{workspace.tab_count === 1 ? "" : "s"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <button
                  type="button"
                  onClick={() => handleOpen(workspace)}
                  disabled={openingId === workspace.id}
                  className="font-medium text-teal-600 hover:underline disabled:opacity-50 dark:text-teal-400"
                >
                  {openingId === workspace.id ? "Opening…" : "Open"}
                </button>
                <button
                  type="button"
                  onClick={() => handleRename(workspace)}
                  className="text-slate-500 hover:text-teal-600 dark:hover:text-teal-400"
                >
                  Rename
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(workspace)}
                  className="text-red-600 hover:underline dark:text-red-400"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {promptDialog}
      {confirmDialog}
    </div>
  );
}
