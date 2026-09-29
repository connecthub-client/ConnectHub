import { useState } from "react";
import { Workspace } from "../../lib/tauri-bridge";
import { useWorkspacesStore } from "../../state/workspacesStore";
import { useConfirm } from "../common/useConfirm";
import { usePrompt } from "../common/usePrompt";
import {
  EmptyState,
  listCardClass,
  PanelScaffold,
  primaryActionClass,
} from "../common/PanelScaffold";
import { NavIcon } from "../common/navIcons";

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
export default function WorkspacesPanel({
  hasOpenSessions,
  onSaveCurrentLayout,
  onOpen,
}: WorkspacesPanelProps) {
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
    if (
      !(await confirm(`Delete workspace "${workspace.label}"?`, {
        danger: true,
      }))
    )
      return;
    setError(null);
    try {
      await deleteWorkspace(workspace.id);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <PanelScaffold
      title="Workspaces"
      description="Save a complete session layout and reopen your working environment in one click."
      action={
        <button
          type="button"
          onClick={handleSave}
          disabled={!hasOpenSessions}
          title={hasOpenSessions ? undefined : "Open at least one tab first"}
          className={primaryActionClass}
        >
          Save current layout
        </button>
      }
    >
      {error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-400">
          {error}
        </p>
      )}
      {workspaces.length === 0 ? (
        <EmptyState
          icon={<NavIcon icon="workspaces" className="h-7 w-7" />}
          title="No saved workspaces"
          description="Open a few servers, arrange your tabs and split panes, then save the layout for later."
        />
      ) : (
        <div
          className={`${listCardClass} divide-y divide-slate-100 dark:divide-slate-800`}
        >
          {workspaces.map((workspace) => (
            <div
              key={workspace.id}
              className="flex items-center justify-between gap-4 px-4 py-3 text-sm hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-600 dark:bg-teal-950/70 dark:text-teal-300">
                  <NavIcon icon="workspaces" className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-800 dark:text-slate-200">
                    {workspace.label}
                  </p>
                  <p className="text-xs text-slate-400">
                    {workspace.tab_count} tab
                    {workspace.tab_count === 1 ? "" : "s"}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <button
                  type="button"
                  onClick={() => handleOpen(workspace)}
                  disabled={openingId === workspace.id}
                  className="font-semibold text-teal-600 hover:text-teal-700 disabled:opacity-50 dark:text-teal-400"
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
    </PanelScaffold>
  );
}
