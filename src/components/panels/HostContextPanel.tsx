import { useEffect, useState } from "react";
import { Host, HostExecResult } from "../../lib/tauri-bridge";
import { useHostsStore } from "../../state/hostsStore";
import { useSnippetsStore } from "../../state/snippetsStore";
import { useVpnStore } from "../../state/vpnStore";

interface HostContextPanelProps {
  host: Host;
  sessionOpen: boolean;
  onEdit: () => void;
  onConnect: () => void;
  onOpenSftp: () => void;
  onNewTunnel: () => void;
}

export default function HostContextPanel({
  host,
  sessionOpen,
  onEdit,
  onConnect,
  onOpenSftp,
  onNewTunnel,
}: HostContextPanelProps) {
  const identities = useHostsStore((s) => s.identities);
  const hosts = useHostsStore((s) => s.hosts);
  const snippets = useSnippetsStore((s) => s.snippets);
  const runOnHosts = useSnippetsStore((s) => s.runOnHosts);
  const vpnProfiles = useVpnStore((s) => s.profiles);
  const vpnStatuses = useVpnStore((s) => s.statuses);
  const vpnConnect = useVpnStore((s) => s.connect);
  const refreshVpnActive = useVpnStore((s) => s.refreshActive);

  const identity = identities.find((i) => i.id === host.identity_id);
  const jumpHost = hosts.find((h) => h.id === host.jump_host_id);
  const vpnProfile = host.vpn_profile_id
    ? vpnProfiles.find((p) => p.id === host.vpn_profile_id)
    : undefined;
  const vpnStatus = host.vpn_profile_id ? vpnStatuses[host.vpn_profile_id] : undefined;
  const vpnConnected = vpnStatus?.state === "connected";
  const vpnBusy = vpnStatus?.state === "connecting" || vpnStatus?.state === "disconnecting";

  const [runningId, setRunningId] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ label: string; result: HostExecResult } | null>(
    null,
  );
  const [vpnError, setVpnError] = useState<string | null>(null);
  const [guardBusy, setGuardBusy] = useState(false);

  useEffect(() => {
    if (!vpnBusy) return;
    const interval = setInterval(refreshVpnActive, 1500);
    return () => clearInterval(interval);
  }, [vpnBusy, refreshVpnActive]);

  // VPN is fully automatic: a host with a VPN profile assigned brings it up
  // by itself the moment you Connect/SFTP/Tunnel, and it's released again
  // once nothing is using it (see vpnStore.releaseIfUnused) - there's no
  // separate VPN button for the user to manage.
  async function guardedAction(action: () => void) {
    if (host.vpn_profile_id && !vpnConnected) {
      setVpnError(null);
      setGuardBusy(true);
      try {
        const status = await vpnConnect(host.vpn_profile_id);
        if (status.state !== "connected") {
          setVpnError(
            status.state === "connecting"
              ? "VPN is taking longer than expected to connect - try again in a moment."
              : (status.message ?? `Could not connect VPN profile "${vpnProfile?.label ?? ""}".`),
          );
          return;
        }
      } catch (e) {
        setVpnError(String(e));
        return;
      } finally {
        setGuardBusy(false);
      }
    }
    action();
  }

  async function handleQuickCommand(snippetId: string, label: string, body: string) {
    setRunningId(snippetId);
    setLastResult(null);
    try {
      const [result] = await runOnHosts([host.id], body);
      setLastResult({ label, result });
    } finally {
      setRunningId(null);
    }
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950">
      <div className="border-b border-neutral-200 p-4 dark:border-neutral-800">
        <h2 className="truncate text-base font-semibold text-neutral-900 dark:text-neutral-50">
          {host.label}
        </h2>
        <p className="text-xs text-neutral-400">
          {host.hostname}:{host.port}
        </p>
      </div>

      <div className="flex gap-2 p-4">
        <button
          type="button"
          onClick={() => guardedAction(onConnect)}
          disabled={!host.identity_id || guardBusy}
          title={host.identity_id ? undefined : "Assign an identity to this host first"}
          className="flex-1 rounded-md bg-teal-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-teal-700 disabled:opacity-40"
        >
          Connect
        </button>
        <button
          type="button"
          onClick={() => guardedAction(onOpenSftp)}
          disabled={!host.identity_id || guardBusy}
          title={host.identity_id ? undefined : "Assign an identity to this host first"}
          className="flex-1 rounded-md border border-neutral-300 px-2 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          SFTP
        </button>
        <button
          type="button"
          onClick={() => guardedAction(onNewTunnel)}
          disabled={guardBusy}
          className="flex-1 rounded-md border border-neutral-300 px-2 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          Tunnel
        </button>
      </div>
      {guardBusy && (
        <p className="-mt-2 px-4 pb-4 text-xs text-neutral-400">
          Connecting VPN profile "{vpnProfile?.label}" before continuing…
        </p>
      )}
      {vpnError && (
        <p className="-mt-2 px-4 pb-4 text-xs text-red-600 dark:text-red-400">{vpnError}</p>
      )}

      <section className="border-t border-neutral-200 p-4 dark:border-neutral-800">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Details
        </h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
          <dt className="text-neutral-500 dark:text-neutral-400">Address</dt>
          <dd className="text-neutral-900 dark:text-neutral-100">{host.hostname}</dd>
          <dt className="text-neutral-500 dark:text-neutral-400">Port</dt>
          <dd className="text-neutral-900 dark:text-neutral-100">{host.port}</dd>
          <dt className="text-neutral-500 dark:text-neutral-400">User</dt>
          <dd className="text-neutral-900 dark:text-neutral-100">{identity?.username ?? "—"}</dd>
          {jumpHost && (
            <>
              <dt className="text-neutral-500 dark:text-neutral-400">Jump host</dt>
              <dd className="text-neutral-900 dark:text-neutral-100">{jumpHost.label}</dd>
            </>
          )}
          {vpnProfile && (
            <>
              <dt className="text-neutral-500 dark:text-neutral-400">VPN profile</dt>
              <dd className="flex items-center gap-1.5 text-neutral-900 dark:text-neutral-100">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    vpnConnected
                      ? "bg-emerald-500"
                      : vpnBusy
                        ? "bg-amber-500"
                        : "bg-neutral-400 dark:bg-neutral-600"
                  }`}
                />
                {vpnProfile.label}
              </dd>
            </>
          )}
        </dl>
      </section>

      <section className="border-t border-neutral-200 p-4 dark:border-neutral-800">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Status
        </h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
          <dt className="text-neutral-500 dark:text-neutral-400">Session</dt>
          <dd className="flex items-center gap-1.5">
            <span
              className={`h-2 w-2 rounded-full ${sessionOpen ? "bg-emerald-500" : "bg-neutral-400 dark:bg-neutral-600"}`}
            />
            <span className="text-neutral-900 dark:text-neutral-100">
              {sessionOpen ? "Connected" : "Not connected"}
            </span>
          </dd>
          <dt className="text-neutral-500 dark:text-neutral-400">Key</dt>
          <dd className="text-neutral-900 dark:text-neutral-100">
            {identity?.auth_method === "private_key"
              ? "Private key"
              : identity?.auth_method === "agent"
                ? "SSH agent"
                : identity?.auth_method === "password"
                  ? "Password"
                  : "—"}
          </dd>
          <dt className="text-neutral-500 dark:text-neutral-400">Last connected</dt>
          <dd className="text-neutral-900 dark:text-neutral-100">
            {host.last_connected_at ? new Date(host.last_connected_at).toLocaleString() : "never"}
          </dd>
        </dl>
      </section>

      {host.notes && (
        <section className="border-t border-neutral-200 p-4 dark:border-neutral-800">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Comments
          </h3>
          <p className="whitespace-pre-wrap text-sm text-neutral-700 dark:text-neutral-300">
            {host.notes}
          </p>
        </section>
      )}

      <section className="border-t border-neutral-200 p-4 dark:border-neutral-800">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Quick commands
          </h3>
          <button
            type="button"
            onClick={onEdit}
            className="text-xs text-neutral-400 hover:text-teal-600"
          >
            Edit host
          </button>
        </div>

        {snippets.length === 0 ? (
          <p className="text-xs text-neutral-400">
            No snippets yet — create one in the Snippets tab to run it here with one click.
          </p>
        ) : (
          <div className="space-y-1.5">
            {snippets.map((s) => (
              <button
                key={s.id}
                type="button"
                disabled={!host.identity_id || runningId === s.id}
                onClick={() => handleQuickCommand(s.id, s.label, s.body)}
                title={s.body}
                className="block w-full rounded-md border border-neutral-300 px-3 py-1.5 text-left text-sm text-neutral-700 hover:border-teal-500 hover:text-teal-700 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-teal-500 dark:hover:text-teal-400"
              >
                {runningId === s.id ? "Running…" : s.label}
              </button>
            ))}
          </div>
        )}

        {lastResult && (
          <div className="mt-3 rounded-md border border-neutral-200 bg-white p-2 text-xs dark:border-neutral-700 dark:bg-neutral-900">
            <p className="mb-1 font-medium text-neutral-900 dark:text-neutral-100">
              {lastResult.label}
              {lastResult.result.output &&
                ` (exit ${lastResult.result.output.exit_status ?? "?"})`}
            </p>
            {lastResult.result.error && (
              <p className="text-red-600 dark:text-red-400">{lastResult.result.error}</p>
            )}
            {lastResult.result.output?.stdout && (
              <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap text-neutral-700 dark:text-neutral-300">
                {lastResult.result.output.stdout}
              </pre>
            )}
            {lastResult.result.output?.stderr && (
              <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap text-red-600 dark:text-red-400">
                {lastResult.result.output.stderr}
              </pre>
            )}
          </div>
        )}
      </section>
    </aside>
  );
}
