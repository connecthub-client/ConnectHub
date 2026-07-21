import { useState } from "react";
import { SshKey } from "../../lib/tauri-bridge";
import { useHostsStore } from "../../state/hostsStore";
import { useConfirm } from "../common/useConfirm";

interface KeysPanelProps {
  onNew: () => void;
}

export default function KeysPanel({ onNew }: KeysPanelProps) {
  const keys = useHostsStore((s) => s.keys);
  const deleteKey = useHostsStore((s) => s.deleteKey);
  const { confirm, confirmDialog } = useConfirm();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete(key: SshKey) {
    setDeleteError(null);
    if (await confirm(`Delete key "${key.label}"? Identities using it will need a replacement.`, { danger: true })) {
      try {
        await deleteKey(key.id);
      } catch (err) {
        setDeleteError(String(err));
      }
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">SSH keys</h2>
        <button
          type="button"
          onClick={onNew}
          className="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700"
        >
          New key
        </button>
      </div>

      {deleteError && (
        <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-400">
          {deleteError}
        </p>
      )}

      {keys.length === 0 ? (
        <p className="text-sm text-neutral-400">
          No keys yet. Generate a new key or import an existing OpenSSH private key.
        </p>
      ) : (
        <div className="divide-y divide-neutral-200 rounded-md border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {keys.map((key) => (
            <div key={key.id} className="flex items-center justify-between px-4 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  {key.label}
                </p>
                <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                  {key.key_type} · {key.fingerprint}
                </p>
              </div>
              <div className="flex shrink-0 gap-3 text-sm">
                <button
                  type="button"
                  onClick={() => handleDelete(key)}
                  className="text-neutral-500 hover:text-red-600"
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
