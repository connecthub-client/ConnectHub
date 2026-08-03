import { KeyboardEvent, useEffect, useMemo, useState } from "react";
import { Host } from "../../lib/tauri-bridge";

export interface PaletteAction {
  id: string;
  label: string;
  run: () => void;
}

interface CommandPaletteProps {
  hosts: Host[];
  actions: PaletteAction[];
  onConnectHost: (host: Host) => void;
  onClose: () => void;
}

type PaletteItem = { kind: "host"; host: Host } | { kind: "action"; action: PaletteAction };

const MAX_RESULTS = 8;

// Ctrl/Cmd+K quick-open - matches hosts by label/hostname/tag (the same
// fields HostTree.tsx's own search matches) plus a handful of static
// navigation actions. Selecting a host routes through the same
// onConnectHost (AppShell's handleConnect) every other entry point uses
// (double-click, right-click "Connect") rather than duplicating VPN
// gating/tab-reuse logic here - see CLAUDE.md's note on why that guard
// lives in one shared place.
export default function CommandPalette({ hosts, actions, onConnectHost, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);

  const q = query.trim().toLowerCase();

  const matchedHosts = useMemo(() => {
    const pool = !q
      ? hosts
      : hosts.filter(
          (h) =>
            h.label.toLowerCase().includes(q) ||
            h.hostname.toLowerCase().includes(q) ||
            h.tags.some((t) => t.label.toLowerCase().includes(q)),
        );
    return pool.slice(0, MAX_RESULTS);
  }, [hosts, q]);

  const matchedActions = useMemo(() => {
    const pool = !q ? actions : actions.filter((a) => a.label.toLowerCase().includes(q));
    return pool.slice(0, MAX_RESULTS);
  }, [actions, q]);

  const items: PaletteItem[] = [
    ...matchedHosts.map((host): PaletteItem => ({ kind: "host", host })),
    ...matchedActions.map((action): PaletteItem => ({ kind: "action", action })),
  ];

  useEffect(() => {
    setSelected(0);
  }, [q]);

  function runItem(item: PaletteItem) {
    if (item.kind === "host") onConnectHost(item.host);
    else item.action.run();
    onClose();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[selected];
      if (item) runItem(item);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="mx-auto mt-24 w-full max-w-lg overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search hosts or run a command…"
          className="w-full border-b border-slate-200 bg-transparent px-4 py-3 text-sm text-slate-900 outline-none dark:border-slate-800 dark:text-slate-100"
        />
        <div className="max-h-96 overflow-y-auto p-2">
          {items.length === 0 && <p className="px-3 py-6 text-center text-sm text-slate-400">No matches.</p>}
          {matchedHosts.length > 0 && (
            <div className="mb-1">
              <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Hosts</p>
              {matchedHosts.map((host, i) => (
                <button
                  key={host.id}
                  type="button"
                  onMouseEnter={() => setSelected(i)}
                  onClick={() => runItem({ kind: "host", host })}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${
                    selected === i
                      ? "bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300"
                      : "text-slate-700 dark:text-slate-300"
                  }`}
                >
                  <span className="truncate">{host.label}</span>
                  <span className="ml-2 shrink-0 text-xs text-slate-400">{host.hostname}</span>
                </button>
              ))}
            </div>
          )}
          {matchedActions.length > 0 && (
            <div>
              <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Actions</p>
              {matchedActions.map((action, i) => {
                const index = matchedHosts.length + i;
                return (
                  <button
                    key={action.id}
                    type="button"
                    onMouseEnter={() => setSelected(index)}
                    onClick={() => runItem({ kind: "action", action })}
                    className={`flex w-full items-center rounded-lg px-3 py-2 text-left text-sm ${
                      selected === index
                        ? "bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300"
                        : "text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    {action.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
