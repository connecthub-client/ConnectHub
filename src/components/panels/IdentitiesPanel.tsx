import { Identity } from "../../lib/tauri-bridge";
import { useHostsStore } from "../../state/hostsStore";

interface IdentitiesPanelProps {
  onNew: () => void;
  onEdit: (identity: Identity) => void;
}

export default function IdentitiesPanel({ onNew, onEdit }: IdentitiesPanelProps) {
  const identities = useHostsStore((s) => s.identities);
  const deleteIdentity = useHostsStore((s) => s.deleteIdentity);
  const keys = useHostsStore((s) => s.keys);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">Identities</h2>
        <button
          type="button"
          onClick={onNew}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          New identity
        </button>
      </div>

      {identities.length === 0 ? (
        <p className="text-sm text-neutral-400">
          No identities yet. Identities bundle a username and auth method so you can reuse them
          across hosts.
        </p>
      ) : (
        <div className="divide-y divide-neutral-200 rounded-md border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {identities.map((identity) => (
            <div key={identity.id} className="flex items-center justify-between px-4 py-2.5">
              <div>
                <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  {identity.label}
                </p>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
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
                  className="text-neutral-500 hover:text-blue-600"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Delete identity "${identity.label}"?`)) {
                      deleteIdentity(identity.id);
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
