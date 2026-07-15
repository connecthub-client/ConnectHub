import { useState } from "react";
import { HostExecResult, Snippet } from "../../lib/tauri-bridge";
import { useHostsStore } from "../../state/hostsStore";
import { useSnippetsStore } from "../../state/snippetsStore";
import { errorClass, labelClass, primaryButtonClass } from "./formStyles";

interface RunSnippetFormProps {
  snippet: Snippet;
  onDone: () => void;
}

export default function RunSnippetForm({ snippet, onDone }: RunSnippetFormProps) {
  const hosts = useHostsStore((s) => s.hosts);
  const runOnHosts = useSnippetsStore((s) => s.runOnHosts);

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
      const res = await runOnHosts(Array.from(selected), snippet.body);
      setResults(res);
    } catch (err) {
      setError(String(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div>
      <pre className="mb-3 whitespace-pre-wrap rounded bg-neutral-100 p-2 font-mono text-xs text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
        {snippet.body}
      </pre>

      {!results && (
        <>
          <p className={labelClass}>Select hosts</p>
          <div className="mb-4 max-h-48 overflow-y-auto rounded border border-neutral-200 dark:border-neutral-700">
            {hosts.length === 0 && (
              <p className="p-3 text-sm text-neutral-400">No hosts yet.</p>
            )}
            {hosts.map((h) => (
              <label
                key={h.id}
                className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-900"
              >
                <input
                  type="checkbox"
                  checked={selected.has(h.id)}
                  onChange={() => toggle(h.id)}
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
                  className="rounded border border-neutral-200 p-2 text-xs dark:border-neutral-700"
                >
                  <p className="mb-1 font-medium text-neutral-900 dark:text-neutral-100">
                    {host?.label ?? r.host_id}
                    {r.output && ` (exit ${r.output.exit_status ?? "?"})`}
                  </p>
                  {r.error && (
                    <p className="text-red-600 dark:text-red-400">{r.error}</p>
                  )}
                  {r.output?.stdout && (
                    <pre className="whitespace-pre-wrap text-neutral-700 dark:text-neutral-300">
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
