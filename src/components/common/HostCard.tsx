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
  onContextMenu,
}: HostCardProps) {
  const accent = host.color ?? "#f97316";
  const initial = host.label.trim().charAt(0).toUpperCase() || "?";

  return (
    <article
      onContextMenu={onContextMenu}
      className={`group aspect-[5/2] min-w-0 overflow-hidden rounded-lg border bg-white text-left shadow-sm outline-none transition hover:border-teal-400 hover:shadow-md focus-within:ring-2 focus-within:ring-teal-500 dark:bg-slate-900 ${
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
        aria-label={`${host.label}, ${host.hostname}:${host.port}. Double-click to connect.`}
        title={
          host.identity_id
            ? `Double-click to connect to ${host.label}`
            : `${host.label} needs credentials before connecting`
        }
        className="grid h-full w-full min-h-0 grid-rows-[1.625rem_1rem] content-center gap-1 overflow-hidden p-2 text-left focus-visible:outline-none"
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
    </article>
  );
}
