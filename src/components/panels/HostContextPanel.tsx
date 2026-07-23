import { useEffect, useMemo, useRef, useState } from "react";
import { Host, HostExecResult, HostStats, hostStats, sessionWrite } from "../../lib/tauri-bridge";
import { useHostsStore } from "../../state/hostsStore";
import { useSnippetsStore } from "../../state/snippetsStore";
import { useVpnStore } from "../../state/vpnStore";
import { useSessionsStore } from "../../state/sessionsStore";
import { useSettingsStore } from "../../state/settingsStore";
import { topUsedCommands, useCommandHistoryStore } from "../../state/commandHistoryStore";
import { HostIcon } from "../common/hostIcons";

const MOST_USED_LIMIT = 10;

const STATS_POLL_MS = 5000;

function formatRate(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${Math.round(bytesPerSec)} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
}

function formatMb(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
}

function StatBar({
  label,
  value,
  max,
  displayValue,
}: {
  label: string;
  value: number;
  max: number;
  displayValue: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-slate-500 dark:text-slate-400">{label}</span>
        <span className="text-slate-900 dark:text-slate-100">{displayValue}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
        <div className="h-full rounded-full bg-teal-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

interface HostContextPanelProps {
  host: Host;
  sessionOpen: boolean;
  // Whether AppShell is currently bringing this host's VPN up on the way
  // to a Connect/SFTP action, and any error from the last attempt - the
  // actual gating lives in AppShell so it applies no matter which UI path
  // (this panel, sidebar double-click, sidebar right-click menu) triggered
  // the connect.
  vpnBusy: boolean;
  vpnError: string | null;
  onConnect: () => void;
  onOpenSftp: () => void;
}

export default function HostContextPanel({
  host,
  sessionOpen,
  vpnBusy: guardBusy,
  vpnError,
  onConnect,
  onOpenSftp,
}: HostContextPanelProps) {
  const identities = useHostsStore((s) => s.identities);
  const snippets = useSnippetsStore((s) => s.snippets);
  const runOnHosts = useSnippetsStore((s) => s.runOnHosts);
  const vpnProfiles = useVpnStore((s) => s.profiles);
  const vpnStatuses = useVpnStore((s) => s.statuses);
  const refreshVpnActive = useVpnStore((s) => s.refreshActive);
  const ensureVpnUp = useVpnStore((s) => s.ensureVpnUp);
  const performancePanelVisible = useSettingsStore((s) => s.performancePanelVisible);
  const togglePerformancePanel = useSettingsStore((s) => s.togglePerformancePanel);
  const hostDetailsVisible = useSettingsStore((s) => s.hostDetailsVisible);
  const toggleHostDetails = useSettingsStore((s) => s.toggleHostDetails);
  const quickCommandAutoRun = useSettingsStore((s) => s.quickCommandAutoRun);
  const toggleQuickCommandAutoRun = useSettingsStore((s) => s.toggleQuickCommandAutoRun);
  const commandHistory = useCommandHistoryStore((s) => s.byHost[host.id]) ?? [];
  const recordCommandRun = useCommandHistoryStore((s) => s.record);
  const remoteTopUsed = useCommandHistoryStore((s) => s.remoteTopUsed[host.id]) ?? [];
  const localTopUsed = useMemo(
    () => topUsedCommands(commandHistory, MOST_USED_LIMIT),
    [commandHistory],
  );
  // Prefer the server's own shell history when we have one - it reflects
  // real usage regardless of which client ran the commands, not just what
  // was typed through this app. Falls back to locally-recorded history
  // (from typing directly in the terminal, or clicking a Quick Command)
  // when the server-side fetch found nothing (restricted account, no
  // history file, non-bash/zsh shell).
  const topUsed =
    remoteTopUsed.length > 0
      ? remoteTopUsed.map((r) => ({ label: r.command, body: r.command, count: r.count }))
      : localTopUsed;

  const openSessions = useSessionsStore((s) => s.openSessions);
  const sessionIds = useSessionsStore((s) => s.sessionIds);
  const terminalTab = openSessions.find((s) => s.host.id === host.id && s.kind === "terminal");
  const liveSessionId = terminalTab ? sessionIds[terminalTab.tabId] : undefined;

  const identity = identities.find((i) => i.id === host.identity_id);
  const vpnProfile = host.vpn_profile_id
    ? vpnProfiles.find((p) => p.id === host.vpn_profile_id)
    : undefined;
  const vpnStatus = host.vpn_profile_id ? vpnStatuses[host.vpn_profile_id] : undefined;
  const vpnConnected = vpnStatus?.state === "connected";
  const vpnTransitioning = vpnStatus?.state === "connecting" || vpnStatus?.state === "disconnecting";

  const [runningId, setRunningId] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ label: string; result: HostExecResult } | null>(
    null,
  );

  useEffect(() => {
    if (!vpnTransitioning) return;
    const interval = setInterval(refreshVpnActive, 1500);
    return () => clearInterval(interval);
  }, [vpnTransitioning, refreshVpnActive]);

  const [stats, setStats] = useState<HostStats | null>(null);
  const [statsUnavailable, setStatsUnavailable] = useState(false);
  const prevSampleRef = useRef<{ rx: number; tx: number; time: number } | null>(null);
  const [netRates, setNetRates] = useState<{ rx: number; tx: number } | null>(null);

  // Only polls while a session is actually open on this host - each poll
  // opens its own short-lived SSH connection (see ssh::stats::fetch), so
  // there's no point running it against a host nothing is connected to.
  useEffect(() => {
    prevSampleRef.current = null;
    setStats(null);
    setNetRates(null);
    setStatsUnavailable(false);
    if (!sessionOpen) return;

    let cancelled = false;
    async function poll() {
      try {
        const result = await hostStats(host.id);
        if (cancelled) return;
        const now = Date.now();
        const prev = prevSampleRef.current;
        if (prev) {
          const elapsedSeconds = (now - prev.time) / 1000;
          if (elapsedSeconds > 0) {
            setNetRates({
              rx: Math.max(0, (result.rx_bytes - prev.rx) / elapsedSeconds),
              tx: Math.max(0, (result.tx_bytes - prev.tx) / elapsedSeconds),
            });
          }
        }
        prevSampleRef.current = { rx: result.rx_bytes, tx: result.tx_bytes, time: now };
        setStats(result);
        setStatsUnavailable(false);
      } catch {
        if (!cancelled) setStatsUnavailable(true);
      }
    }

    poll();
    const interval = setInterval(poll, STATS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [host.id, sessionOpen]);

  // runKey is a snippet's id for the main list, or its label for a "Most
  // used" entry (which may no longer correspond to an existing snippet) -
  // either way it's just what runningId compares against to show "Running…"
  // on the right button.
  async function handleQuickCommand(runKey: string, label: string, body: string) {
    // With a live terminal open, write straight into it - like actually
    // typing the command - rather than the one-off exec channel below,
    // since the whole point is to interact with the session you're already
    // looking at. Auto-Run also sends Enter; off, it's inserted for review
    // so the user can edit or cancel before submitting it themselves.
    if (liveSessionId) {
      setRunningId(runKey);
      setLastResult(null);
      try {
        await sessionWrite(liveSessionId, quickCommandAutoRun ? `${body}\r` : body);
        // Only record here when we know for certain it was submitted
        // (Auto-Run) - otherwise TerminalView's own keystroke capture will
        // record it once the user actually presses Enter, and recording it
        // twice would double-count it in "Recent"/local ranking.
        if (quickCommandAutoRun) {
          recordCommandRun(host.id, { label, body, exitStatus: null, error: null });
        }
      } finally {
        setRunningId(null);
      }
      return;
    }

    setRunningId(runKey);
    setLastResult(null);
    try {
      // No live session to piggy-back on (the branch above), so this is a
      // fresh one-off connection - make sure the host's VPN (if any) is up
      // and routed first, same as Connect/SFTP, rather than letting it
      // silently time out against an unreachable private IP.
      const gate = await ensureVpnUp(host);
      if (!gate.ok) {
        setLastResult({
          label,
          result: {
            host_id: host.id,
            output: null,
            error: gate.message ?? "Could not connect the VPN for this host.",
          },
        });
        return;
      }
      const [result] = await runOnHosts([host.id], body);
      setLastResult({ label, result });
      recordCommandRun(host.id, {
        label,
        body,
        exitStatus: result.output?.exit_status ?? null,
        error: result.error,
      });
    } finally {
      setRunningId(null);
    }
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-950">
      <div className="border-b border-slate-200 p-4 dark:border-slate-800">
        <div className="flex items-center gap-2">
          {host.icon && (
            <HostIcon
              icon={host.icon}
              className="h-5 w-5 shrink-0"
              style={{ color: host.color ?? undefined }}
            />
          )}
          <h2 className="truncate text-base font-semibold text-slate-900 dark:text-slate-50">
            {host.label}
          </h2>
        </div>
        <p className="text-xs text-slate-400">
          {host.hostname}:{host.port}
        </p>
      </div>

      <div className="flex gap-2 p-4">
        <button
          type="button"
          onClick={onConnect}
          disabled={!host.identity_id || guardBusy || sessionOpen}
          title={
            !host.identity_id
              ? "Assign an identity to this host first"
              : sessionOpen
                ? "Already connected"
                : undefined
          }
          className="flex-1 rounded-lg bg-teal-600 px-2 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-teal-700 disabled:opacity-40"
        >
          Connect
        </button>
        <button
          type="button"
          onClick={onOpenSftp}
          disabled={!host.identity_id || guardBusy}
          title={host.identity_id ? undefined : "Assign an identity to this host first"}
          className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          SFTP
        </button>
      </div>
      {guardBusy && (
        <p className="-mt-2 px-4 pb-4 text-xs text-slate-400">
          Connecting VPN profile "{vpnProfile?.label}" before continuing…
        </p>
      )}
      {vpnError && (
        <p className="-mt-2 px-4 pb-4 text-xs text-red-600 dark:text-red-400">{vpnError}</p>
      )}

      <div className="flex-1 space-y-3 p-3">
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Host Details
          </h3>
          <button
            type="button"
            onClick={toggleHostDetails}
            title={hostDetailsVisible ? "Hide host details" : "Show host details"}
            className="text-xs text-slate-400 hover:text-teal-600"
          >
            {hostDetailsVisible ? "Hide" : "Show"}
          </button>
        </div>
        {hostDetailsVisible && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-slate-500 dark:text-slate-400">Address</dt>
            <dd className="text-slate-900 dark:text-slate-100">{host.hostname}</dd>
            <dt className="text-slate-500 dark:text-slate-400">Port</dt>
            <dd className="text-slate-900 dark:text-slate-100">{host.port}</dd>
            <dt className="text-slate-500 dark:text-slate-400">User</dt>
            <dd className="text-slate-900 dark:text-slate-100">{identity?.username ?? "—"}</dd>
            {vpnProfile && (
              <>
                <dt className="text-slate-500 dark:text-slate-400">VPN profile</dt>
                <dd className="flex items-center gap-1.5 text-slate-900 dark:text-slate-100">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      vpnConnected
                        ? "bg-emerald-500"
                        : vpnTransitioning
                          ? "bg-amber-500"
                          : "bg-slate-400 dark:bg-slate-600"
                    }`}
                  />
                  {vpnProfile.label}
                </dd>
              </>
            )}
            <dt className="text-slate-500 dark:text-slate-400">Session</dt>
            <dd className="flex items-center gap-1.5">
              <span
                className={`h-2 w-2 rounded-full ${sessionOpen ? "bg-emerald-500" : "bg-slate-400 dark:bg-slate-600"}`}
              />
              <span className="text-slate-900 dark:text-slate-100">
                {sessionOpen ? "Connected" : "Not connected"}
              </span>
            </dd>
            <dt className="text-slate-500 dark:text-slate-400">Key</dt>
            <dd className="text-slate-900 dark:text-slate-100">
              {identity?.auth_method === "private_key"
                ? "Private key"
                : identity?.auth_method === "agent"
                  ? "SSH agent"
                  : identity?.auth_method === "password"
                    ? "Password"
                    : "—"}
            </dd>
            <dt className="text-slate-500 dark:text-slate-400">Last connected</dt>
            <dd className="text-slate-900 dark:text-slate-100">
              {host.last_connected_at ? new Date(host.last_connected_at).toLocaleString() : "never"}
            </dd>
          </dl>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Performance
          </h3>
          <button
            type="button"
            onClick={togglePerformancePanel}
            title={performancePanelVisible ? "Hide performance" : "Show performance"}
            className="text-xs text-slate-400 hover:text-teal-600"
          >
            {performancePanelVisible ? "Hide" : "Show"}
          </button>
        </div>
        {performancePanelVisible &&
          (!sessionOpen ? (
            <p className="text-xs text-slate-400">
              Connect to see live CPU, memory, and network usage.
            </p>
          ) : stats ? (
            <div className="space-y-3">
              <StatBar
                label="CPU"
                value={stats.cpu_percent}
                max={100}
                displayValue={`${Math.round(stats.cpu_percent)}%`}
              />
              <StatBar
                label="RAM"
                value={stats.mem_used_mb}
                max={stats.mem_total_mb || 1}
                displayValue={`${formatMb(stats.mem_used_mb)} / ${formatMb(stats.mem_total_mb)}`}
              />
              {stats.swap_total_mb > 0 && (
                <StatBar
                  label="Swap"
                  value={stats.swap_used_mb}
                  max={stats.swap_total_mb || 1}
                  displayValue={`${formatMb(stats.swap_used_mb)} / ${formatMb(stats.swap_total_mb)}`}
                />
              )}
              <StatBar
                label="Disk"
                value={stats.disk_used_mb}
                max={stats.disk_total_mb || 1}
                displayValue={`${formatMb(stats.disk_used_mb)} / ${formatMb(stats.disk_total_mb)}`}
              />
              <StatBar
                label="Net"
                value={netRates ? netRates.rx + netRates.tx : 0}
                max={5 * 1024 * 1024}
                displayValue={netRates ? `↓${formatRate(netRates.rx)} ↑${formatRate(netRates.tx)}` : "—"}
              />
            </div>
          ) : statsUnavailable ? (
            <p className="text-xs text-slate-400">Performance stats aren't available for this host.</p>
          ) : (
            <p className="text-xs text-slate-400">Loading…</p>
          ))}
      </section>

      {host.notes && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Comments
          </h3>
          <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">
            {host.notes}
          </p>
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Quick commands
          </h3>
        </div>

        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Auto-Run
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={quickCommandAutoRun}
            aria-label="Auto-Run"
            onClick={toggleQuickCommandAutoRun}
            title={
              quickCommandAutoRun
                ? "On: clicking a command runs it immediately"
                : "Off: clicking a command inserts it for review before you press Enter"
            }
            className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
              quickCommandAutoRun ? "bg-teal-600" : "bg-slate-300 dark:bg-slate-700"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                quickCommandAutoRun ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </button>
        </div>

        {topUsed.length > 0 && (
          <div className="mb-3">
            <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Most used
            </h4>
            <div className="space-y-1.5">
              {topUsed.map((u) => (
                <button
                  key={u.label}
                  type="button"
                  disabled={!host.identity_id || runningId === u.label}
                  onClick={() => handleQuickCommand(u.label, u.label, u.body)}
                  title={u.body}
                  className="flex w-full items-center justify-between rounded-lg border border-slate-300 px-3 py-1.5 text-left text-sm text-slate-700 hover:border-teal-500 hover:text-teal-700 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:border-teal-500 dark:hover:text-teal-400"
                >
                  <span className="truncate">{runningId === u.label ? "Running…" : u.label}</span>
                  <span className="shrink-0 pl-2 text-xs text-slate-400">×{u.count}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {snippets.length > 0 && (
          <div className="space-y-1.5">
            {snippets.map((s) => (
              <button
                key={s.id}
                type="button"
                disabled={!host.identity_id || runningId === s.id}
                onClick={() => handleQuickCommand(s.id, s.label, s.body)}
                title={s.body}
                className="block w-full rounded-lg border border-slate-300 px-3 py-1.5 text-left text-sm text-slate-700 hover:border-teal-500 hover:text-teal-700 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:border-teal-500 dark:hover:text-teal-400"
              >
                {runningId === s.id ? "Running…" : s.label}
              </button>
            ))}
          </div>
        )}

        {lastResult && (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs dark:border-slate-700 dark:bg-slate-800">
            <p className="mb-1 font-medium text-slate-900 dark:text-slate-100">
              {lastResult.label}
              {lastResult.result.output &&
                ` (exit ${lastResult.result.output.exit_status ?? "?"})`}
            </p>
            {lastResult.result.error && (
              <p className="text-red-600 dark:text-red-400">{lastResult.result.error}</p>
            )}
            {lastResult.result.output?.stdout && (
              <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap text-slate-700 dark:text-slate-300">
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
      </div>
    </aside>
  );
}
