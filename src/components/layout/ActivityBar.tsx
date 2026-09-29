import { NavIcon, NavIconKey, sidebarToggleIcon } from "../common/navIcons";

const ITEMS: { tab: string; icon: NavIconKey; label: string }[] = [
  { tab: "hosts", icon: "hosts", label: "Hosts" },
  { tab: "identities", icon: "identities", label: "Identities" },
  { tab: "keys", icon: "keys", label: "Keys" },
  { tab: "vpn", icon: "vpn", label: "VPN" },
  { tab: "workspaces", icon: "workspaces", label: "Workspaces" },
];

// Pinned to the bottom, same as VSCode's Accounts/Settings icons.
const BOTTOM_ITEMS: { tab: string; icon: NavIconKey; label: string }[] = [
  { tab: "backup", icon: "google", label: "Google Backup" },
  { tab: "settings", icon: "settings", label: "Settings" },
];

interface ActivityBarProps {
  activeTab: string | null;
  onSelect: (tab: string) => void;
  leftSidebarVisible: boolean;
  onToggleSidebar: () => void;
}

function ActivityButton({
  item,
  active,
  onSelect,
}: {
  item: { tab: string; icon: NavIconKey; label: string };
  active: boolean;
  onSelect: (tab: string) => void;
}) {
  return (
    <button
      type="button"
      title={item.label}
      aria-label={item.label}
      onClick={() => onSelect(item.tab)}
      className={`group relative flex h-9 w-9 items-center justify-center rounded-lg ${
        active
          ? "bg-teal-600 text-white shadow-sm shadow-teal-950/20"
          : "text-slate-500 hover:bg-white hover:text-teal-700 hover:shadow-sm dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-teal-300"
      }`}
    >
      {active && (
        <span className="absolute -left-1.5 h-5 w-0.5 rounded-r-full bg-teal-400" />
      )}
      <NavIcon icon={item.icon} className="h-[18px] w-[18px]" />
    </button>
  );
}

// A VSCode-style Activity Bar: a narrow, always-visible icon strip. Clicking
// the already-active item is how the Primary Side Bar's show/hide toggle
// works (see AppShell.tsx's handleActivitySelect) - matching VSCode's own
// behavior, rather than a separate hamburger button living elsewhere.
export default function ActivityBar({
  activeTab,
  onSelect,
  leftSidebarVisible,
  onToggleSidebar,
}: ActivityBarProps) {
  return (
    <nav className="flex w-[52px] shrink-0 flex-col items-center gap-1 border-r border-slate-200 bg-slate-100/90 py-2 dark:border-slate-800 dark:bg-slate-950">
      <div
        className="mb-1.5 flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-teal-500 to-teal-700 text-[11px] font-black tracking-tight text-white shadow-sm"
        title="ConnectHub"
      >
        CH
      </div>
      <button
        type="button"
        onClick={onToggleSidebar}
        title={leftSidebarVisible ? "Hide sidebar" : "Show sidebar"}
        aria-label={leftSidebarVisible ? "Hide sidebar" : "Show sidebar"}
        className="mb-1 flex h-8 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-white hover:text-teal-700 dark:hover:bg-slate-800 dark:hover:text-teal-300"
      >
        <NavIcon
          icon={sidebarToggleIcon("left", leftSidebarVisible)}
          className="h-4 w-4"
        />
      </button>
      {ITEMS.map((item) => (
        <ActivityButton
          key={item.tab}
          item={item}
          active={activeTab === item.tab}
          onSelect={onSelect}
        />
      ))}
      <div className="mt-auto flex flex-col items-center gap-1">
        {BOTTOM_ITEMS.map((item) => (
          <ActivityButton
            key={item.tab}
            item={item}
            active={activeTab === item.tab}
            onSelect={onSelect}
          />
        ))}
      </div>
    </nav>
  );
}
