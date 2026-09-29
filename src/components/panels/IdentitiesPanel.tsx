import { useState } from "react";
import { Identity } from "../../lib/tauri-bridge";
import { useHostsStore } from "../../state/hostsStore";
import { useConfirm } from "../common/useConfirm";
import {
  EmptyState,
  listCardClass,
  PanelScaffold,
  primaryActionClass,
} from "../common/PanelScaffold";
import { NavIcon } from "../common/navIcons";

interface IdentitiesPanelProps {
  onNew: () => void;
  onEdit: (identity: Identity) => void;
}

export default function IdentitiesPanel({
  onNew,
  onEdit,
}: IdentitiesPanelProps) {
  const identities = useHostsStore((s) => s.identities);
  const deleteIdentity = useHostsStore((s) => s.deleteIdentity);
  const keys = useHostsStore((s) => s.keys);
  const { confirm, confirmDialog } = useConfirm();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete(identity: Identity) {
    setDeleteError(null);
    if (
      await confirm(`Delete identity "${identity.label}"?`, { danger: true })
    ) {
      try {
        await deleteIdentity(identity.id);
      } catch (err) {
        setDeleteError(String(err));
      }
    }
  }

  return (
    <PanelScaffold
      title="Identities"
      description="Reuse secure sign-in details across your servers without entering them each time."
      action={
        <button type="button" onClick={onNew} className={primaryActionClass}>
          + New identity
        </button>
      }
    >
      {deleteError && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-400">
          {deleteError}
        </p>
      )}

      {identities.length === 0 ? (
        <EmptyState
          icon={<NavIcon icon="identities" className="h-7 w-7" />}
          title="No identities yet"
          description="Bundle a username and authentication method, then reuse it across multiple servers."
          action={
            <button
              type="button"
              onClick={onNew}
              className={primaryActionClass}
            >
              Create identity
            </button>
          }
        />
      ) : (
        <div
          className={`${listCardClass} divide-y divide-slate-100 dark:divide-slate-800`}
        >
          {identities.map((identity) => (
            <div
              key={identity.id}
              className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-600 dark:bg-teal-950/70 dark:text-teal-300">
                  <NavIcon icon="identities" className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    {identity.label}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {identity.username} ·{" "}
                    {authMethodLabel(identity.auth_method)}
                    {identity.auth_method === "private_key" &&
                      identity.ssh_key_id &&
                      ` (${keys.find((k) => k.id === identity.ssh_key_id)?.label ?? "unknown key"})`}
                  </p>
                </div>
              </div>
              <div className="flex gap-3 text-sm font-semibold">
                <button
                  type="button"
                  onClick={() => onEdit(identity)}
                  className="text-slate-500 hover:text-teal-600"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(identity)}
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
    </PanelScaffold>
  );
}

function authMethodLabel(method: Identity["auth_method"]): string {
  switch (method) {
    case "password":
      return "Password";
    case "private_key":
      return "Private key";
    case "agent":
      return "SSH agent";
  }
}
