import { Host, Identity } from "../../lib/tauri-bridge";
import { HostIcon } from "./hostIcons";

interface HostCardProps {
  host: Host;
  identity?: Identity;
  isSelected: boolean;
  isOpen: boolean;
  onSelect: () => void;
  onConnect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

function authLabel(identity?: Identity): string {
  switch (identity?.auth_method) {
    case "private_key":
      return "Private key";
    case "agent":
      return "SSH agent";
    case "password":
      return "Password";
    default:
      return "No credentials";
  }
}

export default function HostCard({
  host,
  identity,
  isSelected,
  isOpen,
  onSelect,
  onConnect,
  onEdit,
  onDelete,
  onContextMenu,
}: HostCardProps) {
  const accent = host.color ?? "#6366f1";
  const initial = host.label.trim().charAt(0).toUpperCase() || "?";

  return (
    <article
      onContextMenu={onContextMenu}
      className={`group flex min-h-36 min-w-0 cursor-default flex-col rounded-xl border bg-white p-2.5 text-left shadow-sm outline-none transition hover:-translate-y-0.5 hover:shadow-md focus-within:ring-2 focus-within:ring-indigo-500 dark:bg-slate-900 ${
        isSelected
          ? "border-indigo-500 ring-1 ring-indigo-500/20 dark:border-indigo-400"
          : "border-slate-200 hover:border-indigo-300 dark:border-slate-800 dark:hover:border-indigo-700"
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        onDoubleClick={() => {
          onSelect();
          if (host.identity_id) onConnect();
        }}
        aria-label={`${host.label}, ${host.hostname}:${host.port}. Select server.`}
        className="flex flex-1 flex-col text-left focus-visible:outline-none"
      >
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white shadow-sm"
          style={{ backgroundColor: accent }}
        >
          {host.icon ? <HostIcon icon={host.icon} className="h-3.5 w-3.5" /> : initial}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[13px] font-bold text-slate-900 dark:text-slate-50">{host.label}</h3>
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                isOpen ? "bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.14)]" : "bg-slate-300 dark:bg-slate-700"
              }`}
              title={isOpen ? "Session open" : "Not connected"}
            />
          </div>
          <p className="truncate font-mono text-[10px] text-slate-500 dark:text-slate-400">
            {identity?.username ? `${identity.username}@` : ""}{host.hostname}:{host.port}
          </p>
        </div>
      </div>

      <div className="mt-3 flex max-h-11 flex-wrap gap-1 overflow-hidden">
        <span className="max-w-full truncate rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300">
          {authLabel(identity)}
        </span>
        {host.vpn_profile_id && (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300">
            VPN
          </span>
        )}
        {host.tags.slice(0, 2).map((tag) => (
          <span
            key={tag.id}
            className="max-w-20 truncate rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            title={tag.label}
          >
            {tag.label}
          </span>
        ))}
        {host.tags.length > 2 && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400" title={host.tags.slice(2).map((tag) => tag.label).join(", ")}>
            +{host.tags.length - 2}
          </span>
        )}
      </div>
      </button>

      <div className="mt-auto flex gap-1.5 pt-3">
        <button
          type="button"
          disabled={!host.identity_id}
          onClick={(e) => {
            e.stopPropagation();
            onConnect();
          }}
          className="min-w-0 flex-1 rounded-lg bg-indigo-600 px-2 py-1.5 text-[11px] font-bold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:bg-slate-800 dark:disabled:text-slate-600"
          title={host.identity_id ? `Connect to ${host.label}` : "Add credentials before connecting"}
        >
          Connect
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className="flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:border-indigo-300 hover:text-indigo-700 dark:border-slate-700 dark:text-slate-400 dark:hover:border-indigo-700 dark:hover:text-indigo-300"
          aria-label={`Edit ${host.label}`}
          title={`Edit ${host.label}`}
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-3.5 w-3.5" aria-hidden="true">
            <path d="M4 14.5V16h1.5L15 6.5 13.5 5 4 14.5Z" />
            <path d="m12.5 6 1.5-1.5a1.4 1.4 0 0 1 2 2L14.5 8" />
          </svg>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:border-rose-300 hover:text-rose-600 dark:border-slate-700 dark:hover:border-rose-800 dark:hover:text-rose-400"
          aria-label={`Delete ${host.label}`}
          title={`Delete ${host.label}`}
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-3.5 w-3.5" aria-hidden="true">
            <path d="M4 6h12M8 3.5h4M6 6l.6 10h6.8L14 6M8.5 9v4.5M11.5 9v4.5" />
          </svg>
        </button>
      </div>
    </article>
  );
}
