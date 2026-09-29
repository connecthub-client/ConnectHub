import { useState } from "react";
import { SshKey } from "../../lib/tauri-bridge";
import { useHostsStore } from "../../state/hostsStore";
import { useConfirm } from "../common/useConfirm";
import { EmptyState, listCardClass, PanelScaffold, primaryActionClass } from "../common/PanelScaffold";
import { NavIcon } from "../common/navIcons";

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
    <PanelScaffold title="SSH keys" description="Generate or import private keys and keep them protected in your encrypted vault." action={<button
          type="button"
          onClick={onNew}
          className={primaryActionClass}
        >
          + New key
        </button>}>

      {deleteError && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-400">
          {deleteError}
        </p>
      )}

      {keys.length === 0 ? (
        <EmptyState icon={<NavIcon icon="keys" className="h-7 w-7" />} title="No SSH keys yet" description="Generate a modern key pair or securely import an existing OpenSSH private key." action={<button type="button" onClick={onNew} className={primaryActionClass}>Add SSH key</button>} />
      ) : (
        <div className={`${listCardClass} divide-y divide-slate-100 dark:divide-slate-800`}>
          {keys.map((key) => (
            <div key={key.id} className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600 dark:bg-violet-950/60 dark:text-violet-300"><NavIcon icon="keys" className="h-5 w-5" /></div>
                <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  {key.label}
                </p>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                  {key.key_type} · {key.fingerprint}
                </p>
                </div>
              </div>
              <div className="flex shrink-0 gap-3 text-sm">
                <button
                  type="button"
                  onClick={() => handleDelete(key)}
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
