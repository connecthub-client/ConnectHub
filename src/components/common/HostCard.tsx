import { Host, Identity } from "../../lib/tauri-bridge";
import { HostIcon } from "./hostIcons";
import { Badge, StatusIndicator } from "./ui";

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
  const accent = host.color ?? "#f97316";
  const initial = host.label.trim().charAt(0).toUpperCase() || "?";

  return (
    <article
      onContextMenu={onContextMenu}
      className={`group grid aspect-[5/2] min-w-0 grid-rows-[minmax(0,1fr)_2rem] gap-0.5 overflow-hidden rounded-lg border bg-white p-1.5 text-left shadow-sm outline-none transition hover:border-teal-400 hover:shadow-md focus-within:ring-2 focus-within:ring-teal-500 dark:bg-slate-900 ${
        isSelected
          ? "border-teal-500 ring-1 ring-teal-500/25 dark:border-teal-400"
          : "border-slate-200 hover:border-teal-300 dark:border-slate-800 dark:hover:border-teal-700"
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
        className="grid min-h-0 grid-rows-[1.625rem_1rem] gap-0.5 overflow-hidden text-left focus-visible:outline-none"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-white shadow-sm"
            style={{ backgroundColor: accent }}
          >
            {host.icon ? (
              <HostIcon icon={host.icon} className="h-3.5 w-3.5" />
            ) : (
              initial
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3
                className="truncate text-xs font-bold leading-4 text-slate-900 dark:text-slate-50"
                title={host.label}
              >
                {host.label}
              </h3>
              <StatusIndicator
                state={isOpen ? "success" : "idle"}
                label={isOpen ? "Session open" : "Not connected"}
              />
            </div>
            <p
              className="truncate font-mono text-[9px] leading-3 text-slate-500 dark:text-slate-400"
              title={`${identity?.username ? `${identity.username}@` : ""}${host.hostname}:${host.port}`}
            >
              {identity?.username ? `${identity.username}@` : ""}
              {host.hostname}:{host.port}
            </p>
          </div>
        </div>

        <div className="flex h-4 flex-nowrap gap-1 overflow-hidden">
          <Badge
            compact
            className="max-w-full shrink-0 truncate bg-teal-50 text-teal-700 dark:bg-teal-950/70 dark:text-teal-300"
          >
            {authLabel(identity)}
          </Badge>
          {host.vpn_profile_id && (
            <Badge
              compact
              className="shrink-0 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300"
            >
              VPN
            </Badge>
          )}
          {host.tags.slice(0, 2).map((tag) => (
            <Badge
              compact
              key={tag.id}
              className="max-w-14 shrink truncate"
              title={tag.label}
            >
              {tag.label}
            </Badge>
          ))}
          {host.tags.length > 2 && (
            <Badge
              compact
              className="shrink-0 text-slate-500 dark:text-slate-400"
              title={host.tags
                .slice(2)
                .map((tag) => tag.label)
                .join(", ")}
            >
              +{host.tags.length - 2}
            </Badge>
          )}
        </div>
      </button>

      <div className="flex h-8 gap-1">
        <button
          type="button"
          disabled={!host.identity_id}
          onClick={(e) => {
            e.stopPropagation();
            onConnect();
          }}
          className="h-8 min-w-0 flex-1 rounded-md bg-teal-600 px-2 text-[11px] font-bold text-white shadow-sm hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:bg-slate-800 dark:disabled:text-slate-600"
          title={
            host.identity_id
              ? `Connect to ${host.label}`
              : "Add credentials before connecting"
          }
        >
          Connect
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:border-teal-300 hover:text-teal-700 dark:border-slate-700 dark:text-slate-400 dark:hover:border-teal-700 dark:hover:text-teal-300"
          aria-label={`Edit ${host.label}`}
          title={`Edit ${host.label}`}
        >
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            className="h-3.5 w-3.5"
            aria-hidden="true"
          >
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
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 text-slate-400 hover:border-rose-300 hover:text-rose-600 dark:border-slate-700 dark:hover:border-rose-800 dark:hover:text-rose-400"
          aria-label={`Delete ${host.label}`}
          title={`Delete ${host.label}`}
        >
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            className="h-3.5 w-3.5"
            aria-hidden="true"
          >
            <path d="M4 6h12M8 3.5h4M6 6l.6 10h6.8L14 6M8.5 9v4.5M11.5 9v4.5" />
          </svg>
        </button>
      </div>
    </article>
  );
}
