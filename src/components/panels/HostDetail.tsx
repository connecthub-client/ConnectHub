import { Host } from "../../lib/tauri-bridge";
import { useHostsStore } from "../../state/hostsStore";

interface HostDetailProps {
  host: Host;
  onEdit: () => void;
  onConnect: () => void;
  onOpenSftp: () => void;
  onNewTunnel: () => void;
}

export default function HostDetail({ host, onEdit, onConnect, onOpenSftp, onNewTunnel }: HostDetailProps) {
  const identities = useHostsStore((s) => s.identities);
  const hosts = useHostsStore((s) => s.hosts);
  const identity = identities.find((i) => i.id === host.identity_id);
  const jumpHost = hosts.find((h) => h.id === host.jump_host_id);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
          {host.label}
        </h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onConnect}
            disabled={!host.identity_id}
            title={host.identity_id ? undefined : "Assign an identity to this host first"}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Connect
          </button>
          <button
            type="button"
            onClick={onOpenSftp}
            disabled={!host.identity_id}
            title={host.identity_id ? undefined : "Assign an identity to this host first"}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            SFTP
          </button>
          <button
            type="button"
            onClick={onNewTunnel}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Tunnel
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Edit
          </button>
        </div>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-neutral-500 dark:text-neutral-400">Hostname</dt>
        <dd className="text-neutral-900 dark:text-neutral-100">
          {host.hostname}:{host.port}
        </dd>

        <dt className="text-neutral-500 dark:text-neutral-400">Identity</dt>
        <dd className="text-neutral-900 dark:text-neutral-100">
          {identity ? `${identity.label} (${identity.username})` : "—"}
        </dd>

        <dt className="text-neutral-500 dark:text-neutral-400">Jump host</dt>
        <dd className="text-neutral-900 dark:text-neutral-100">{jumpHost?.label ?? "—"}</dd>

        <dt className="text-neutral-500 dark:text-neutral-400">Last connected</dt>
        <dd className="text-neutral-900 dark:text-neutral-100">
          {host.last_connected_at ? new Date(host.last_connected_at).toLocaleString() : "never"}
        </dd>

        {host.notes && (
          <>
            <dt className="text-neutral-500 dark:text-neutral-400">Notes</dt>
            <dd className="whitespace-pre-wrap text-neutral-900 dark:text-neutral-100">
              {host.notes}
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}
