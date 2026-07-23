import { NavIcon, NavIconKey, sidebarToggleIcon } from "../common/navIcons";

const ITEMS: { tab: string; icon: NavIconKey; label: string }[] = [
  { tab: "hosts", icon: "hosts", label: "Hosts" },
  { tab: "identities", icon: "identities", label: "Identities" },
  { tab: "keys", icon: "keys", label: "Keys" },
  { tab: "vpn", icon: "vpn", label: "VPN" },
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
      className={`flex h-10 w-10 items-center justify-center rounded-lg ${
        active
          ? "bg-teal-600 text-white shadow-md shadow-teal-600/30"
          : "text-slate-500 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-800"
      }`}
    >
      <NavIcon icon={item.icon} className="h-5 w-5" />
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
    <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-slate-200 bg-slate-100 py-2 dark:border-slate-800 dark:bg-slate-950">
      <button
        type="button"
        onClick={onToggleSidebar}
        title={leftSidebarVisible ? "Hide sidebar" : "Show sidebar"}
        aria-label={leftSidebarVisible ? "Hide sidebar" : "Show sidebar"}
        className="mb-1 flex h-7 w-10 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200 hover:text-teal-600 dark:hover:bg-slate-800 dark:hover:text-teal-400"
      >
        <NavIcon icon={sidebarToggleIcon("left", leftSidebarVisible)} className="h-4 w-4" />
      </button>
      {ITEMS.map((item) => (
        <ActivityButton key={item.tab} item={item} active={activeTab === item.tab} onSelect={onSelect} />
      ))}
      <div className="mt-auto flex flex-col items-center gap-1">
        {BOTTOM_ITEMS.map((item) => (
          <ActivityButton key={item.tab} item={item} active={activeTab === item.tab} onSelect={onSelect} />
        ))}
      </div>
    </nav>
  );
}
