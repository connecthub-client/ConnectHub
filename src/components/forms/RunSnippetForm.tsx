import { useState } from "react";
import { HostExecResult, Snippet } from "../../lib/tauri-bridge";
import { useHostsStore } from "../../state/hostsStore";
import { useSnippetsStore } from "../../state/snippetsStore";
import { useVpnStore } from "../../state/vpnStore";
import { errorClass, labelClass, primaryButtonClass } from "./formStyles";

interface RunSnippetFormProps {
  snippet: Snippet;
  onDone: () => void;
}

export default function RunSnippetForm({ snippet, onDone }: RunSnippetFormProps) {
  const hosts = useHostsStore((s) => s.hosts);
  const runOnHosts = useSnippetsStore((s) => s.runOnHosts);
  const ensureVpnUp = useVpnStore((s) => s.ensureVpnUp);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<HostExecResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggle(hostId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(hostId)) next.delete(hostId);
      else next.add(hostId);
      return next;
    });
  }

  async function handleRun() {
    setError(null);
    setRunning(true);
    try {
      const targetHosts = hosts.filter((h) => selected.has(h.id));
      // Gate every target host's VPN in parallel (they may not even share
      // the same profile) rather than assuming a host is reachable just
      // because it was selected - a host whose VPN never came up would
      // otherwise just silently time out inside runOnHosts. A host that
      // fails the gate is skipped rather than aborting the whole batch, so
      // one unreachable host doesn't block results for the rest.
      const gateResults = await Promise.all(targetHosts.map((h) => ensureVpnUp(h)));
      const readyHostIds = targetHosts
        .filter((_, i) => gateResults[i].ok)
        .map((h) => h.id);
      const vpnFailures: HostExecResult[] = targetHosts
        .map((h, i) => ({ h, gate: gateResults[i] }))
        .filter(({ gate }) => !gate.ok)
        .map(({ h, gate }) => ({
          host_id: h.id,
          output: null,
          error: gate.message ?? "Could not connect the VPN for this host.",
        }));
      const execResults = readyHostIds.length > 0 ? await runOnHosts(readyHostIds, snippet.body) : [];
      setResults([...execResults, ...vpnFailures]);
    } catch (err) {
      setError(String(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div>
      <pre className="mb-3 whitespace-pre-wrap rounded bg-slate-100 p-2 font-mono text-xs text-slate-700 dark:bg-slate-900 dark:text-slate-300">
        {snippet.body}
      </pre>

      {!results && (
        <>
          <p className={labelClass}>Select hosts</p>
          <div className="mb-4 max-h-48 overflow-y-auto rounded border border-slate-200 dark:border-slate-700">
            {hosts.length === 0 && (
              <p className="p-3 text-sm text-slate-400">No hosts yet.</p>
            )}
            {hosts.map((h) => (
              <label
                key={h.id}
                className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-900"
              >
                <input
                  type="checkbox"
                  checked={selected.has(h.id)}
                  onChange={() => toggle(h.id)}
                  className="accent-teal-600"
                />
                {h.label}
              </label>
            ))}
          </div>

          {error && <p className={errorClass}>{error}</p>}

          <button
            type="button"
            disabled={selected.size === 0 || running}
            onClick={handleRun}
            className={primaryButtonClass}
          >
            {running ? "Running…" : `Run on ${selected.size} host(s)`}
          </button>
        </>
      )}

      {results && (
        <div>
          <div className="mb-4 max-h-80 space-y-3 overflow-y-auto">
            {results.map((r) => {
              const host = hosts.find((h) => h.id === r.host_id);
              return (
                <div
                  key={r.host_id}
                  className="rounded border border-slate-200 p-2 text-xs dark:border-slate-700"
                >
                  <p className="mb-1 font-medium text-slate-900 dark:text-slate-100">
                    {host?.label ?? r.host_id}
                    {r.output && ` (exit ${r.output.exit_status ?? "?"})`}
                  </p>
                  {r.error && (
                    <p className="text-red-600 dark:text-red-400">{r.error}</p>
                  )}
                  {r.output?.stdout && (
                    <pre className="whitespace-pre-wrap text-slate-700 dark:text-slate-300">
                      {r.output.stdout}
                    </pre>
                  )}
                  {r.output?.stderr && (
                    <pre className="whitespace-pre-wrap text-red-600 dark:text-red-400">
                      {r.output.stderr}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
          <button type="button" onClick={onDone} className={primaryButtonClass}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}
