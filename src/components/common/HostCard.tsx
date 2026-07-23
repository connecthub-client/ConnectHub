import { Host } from "../../lib/tauri-bridge";
import { HostIcon } from "./hostIcons";

interface HostCardProps {
  host: Host;
  isSelected: boolean;
  isOpen: boolean;
  onSelect: () => void;
  onConnect: () => void;
}

// One host, rendered as a card - shared by the center Hosts grid's flat
// fallback and its grouped/recursive rendering, so both use the exact same
// markup. The identity-required double-click guard lives here rather than
// in each caller, mirroring HostTree.tsx's renderHostRow doing the same for
// its own row markup.
export default function HostCard({ host, isSelected, isOpen, onSelect, onConnect }: HostCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      onDoubleClick={() => {
        onSelect();
        if (host.identity_id) onConnect();
      }}
      title={host.identity_id ? "Double-click to connect" : undefined}
      className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left shadow-sm transition-shadow hover:shadow-md ${
        isSelected
          ? "border-teal-500 bg-teal-50 dark:bg-teal-950/30"
          : "border-slate-200 bg-white hover:border-teal-400 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-teal-600"
      }`}
    >
      <div className="flex w-full items-center gap-2">
        {host.icon && (
          <HostIcon icon={host.icon} className="h-4 w-4 shrink-0" style={{ color: host.color ?? undefined }} />
        )}
        <span className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{host.label}</span>
        <span
          className={`ml-auto h-1.5 w-1.5 shrink-0 rounded-full ${
            isOpen ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-700"
          }`}
        />
      </div>
      <span className="truncate text-xs text-slate-400">
        {host.hostname}:{host.port}
      </span>
    </button>
  );
}
