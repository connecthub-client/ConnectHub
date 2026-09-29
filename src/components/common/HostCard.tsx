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
      className={`group flex min-h-52 cursor-default flex-col rounded-2xl border bg-white p-4 text-left shadow-sm outline-none transition hover:-translate-y-0.5 hover:shadow-lg focus-within:ring-2 focus-within:ring-indigo-500 dark:bg-slate-900 ${
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
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white shadow-sm"
          style={{ backgroundColor: accent }}
        >
          {host.icon ? <HostIcon icon={host.icon} className="h-5 w-5" /> : initial}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-bold text-slate-900 dark:text-slate-50">{host.label}</h3>
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                isOpen ? "bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.14)]" : "bg-slate-300 dark:bg-slate-700"
              }`}
              title={isOpen ? "Session open" : "Not connected"}
            />
          </div>
          <p className="truncate font-mono text-xs text-slate-500 dark:text-slate-400">
            {identity?.username ? `${identity.username}@` : ""}{host.hostname}:{host.port}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300">
          {authLabel(identity)}
        </span>
        {host.vpn_profile_id && (
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300">
            VPN
          </span>
        )}
        {host.tags.map((tag) => (
          <span
            key={tag.id}
            className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300"
          >
            {tag.label}
          </span>
        ))}
      </div>
      </button>

      <div className="mt-auto flex gap-2 pt-4">
        <button
          type="button"
          disabled={!host.identity_id}
          onClick={(e) => {
            e.stopPropagation();
            onConnect();
          }}
          className="flex-1 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:bg-slate-800 dark:disabled:text-slate-600"
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
          className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:border-indigo-300 hover:text-indigo-700 dark:border-slate-700 dark:text-slate-300 dark:hover:border-indigo-700 dark:hover:text-indigo-300"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-500 hover:border-rose-300 hover:text-rose-600 dark:border-slate-700 dark:text-slate-400 dark:hover:border-rose-800 dark:hover:text-rose-400"
          aria-label={`Delete ${host.label}`}
        >
          Delete
        </button>
      </div>
    </article>
  );
}
