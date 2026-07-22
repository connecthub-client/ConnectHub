import { useState } from "react";
import { Identity } from "../../lib/tauri-bridge";
import { useHostsStore } from "../../state/hostsStore";
import { useConfirm } from "../common/useConfirm";

interface IdentitiesPanelProps {
  onNew: () => void;
  onEdit: (identity: Identity) => void;
}

export default function IdentitiesPanel({ onNew, onEdit }: IdentitiesPanelProps) {
  const identities = useHostsStore((s) => s.identities);
  const deleteIdentity = useHostsStore((s) => s.deleteIdentity);
  const keys = useHostsStore((s) => s.keys);
  const { confirm, confirmDialog } = useConfirm();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete(identity: Identity) {
    setDeleteError(null);
    if (await confirm(`Delete identity "${identity.label}"?`, { danger: true })) {
      try {
        await deleteIdentity(identity.id);
      } catch (err) {
        setDeleteError(String(err));
      }
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Identities</h2>
        <button
          type="button"
          onClick={onNew}
          className="rounded-lg bg-teal-600 shadow-sm px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700"
        >
          New identity
        </button>
      </div>

      {deleteError && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-400">
          {deleteError}
        </p>
      )}

      {identities.length === 0 ? (
        <p className="text-sm text-slate-400">
          No identities yet. Identities bundle a username and auth method so you can reuse them
          across hosts.
        </p>
      ) : (
        <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          {identities.map((identity) => (
            <div key={identity.id} className="flex items-center justify-between px-4 py-2.5">
              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  {identity.label}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {identity.username} · {authMethodLabel(identity.auth_method)}
                  {identity.auth_method === "private_key" &&
                    identity.ssh_key_id &&
                    ` (${keys.find((k) => k.id === identity.ssh_key_id)?.label ?? "unknown key"})`}
                </p>
              </div>
              <div className="flex gap-3 text-sm">
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
    </div>
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
