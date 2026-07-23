import { Fragment, useEffect, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import ActivityBar from "../components/layout/ActivityBar";
import { NavIcon, sidebarToggleIcon } from "../components/common/navIcons";
import ResizeHandle from "../components/common/ResizeHandle";
import HostTree from "../components/sidebar/HostTree";
import Modal from "../components/common/Modal";
import GroupForm from "../components/forms/GroupForm";
import HostForm from "../components/forms/HostForm";
import IdentityForm from "../components/forms/IdentityForm";
import KeyForm from "../components/forms/KeyForm";
import HostContextPanel from "../components/panels/HostContextPanel";
import HostCard from "../components/common/HostCard";
import IdentitiesPanel from "../components/panels/IdentitiesPanel";
import KeysPanel from "../components/panels/KeysPanel";
import SnippetsDrawer from "../components/panels/SnippetsDrawer";
import SnippetForm from "../components/forms/SnippetForm";
import RunSnippetForm from "../components/forms/RunSnippetForm";
import VpnPanel from "../components/panels/VpnPanel";
import VpnProfileForm from "../components/forms/VpnProfileForm";
import SettingsPanel from "../components/panels/SettingsPanel";
import BackupPanel from "../components/panels/BackupPanel";
import TerminalView from "../components/terminal/TerminalView";
import SftpBrowser from "../components/sftp/SftpBrowser";
import { Group, Host, Identity, ImportSummary, localReadTextFile, localWriteTextFile, Snippet, VpnProfile } from "../lib/tauri-bridge";
import { getGroupChildren } from "../lib/groupTree";
import { useHostsStore } from "../state/hostsStore";
import { useSessionsStore } from "../state/sessionsStore";
import { useVpnStore } from "../state/vpnStore";
import {
  DEFAULT_LEFT_SIDEBAR_WIDTH,
  DEFAULT_RIGHT_PANEL_WIDTH,
  useSettingsStore,
} from "../state/settingsStore";

type ManageTab = "hosts" | "identities" | "keys" | "vpn" | "backup" | "settings";
type MainView = { type: "manage"; tab: ManageTab } | { type: "session"; tabId: string };

type ModalState =
  | { kind: "group"; group?: Group; parentId?: string | null }
  | { kind: "host"; host?: Host; groupId?: string | null }
  | { kind: "identity"; identity?: Identity }
  | { kind: "key" }
  | { kind: "snippet"; snippet?: Snippet }
  | { kind: "run-snippet"; snippet: Snippet }
  | { kind: "vpn-profile"; profile?: VpnProfile }
  | null;

export default function AppShell() {
  const loadAll = useHostsStore((s) => s.loadAll);
  const loaded = useHostsStore((s) => s.loaded);
  const hosts = useHostsStore((s) => s.hosts);
  const groups = useHostsStore((s) => s.groups);
  const exportHostsCsv = useHostsStore((s) => s.exportHostsCsv);
  const importHostsCsv = useHostsStore((s) => s.importHostsCsv);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [hostsGridSearch, setHostsGridSearch] = useState("");

  const openSessions = useSessionsStore((s) => s.openSessions);
  const sessionStatuses = useSessionsStore((s) => s.statuses);
  const openSession = useSessionsStore((s) => s.openSession);
  const closeSession = useSessionsStore((s) => s.closeSession);
  const reorderSessions = useSessionsStore((s) => s.reorderSessions);
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  // Which index the dragged tab would land at if dropped right now - drawn
  // as an insertion line before that tab (or, at openSessions.length, at
  // the very end of the bar) so the user sees where it'll land before
  // releasing, not just which tab is being dragged.
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const tabBarRef = useRef<HTMLDivElement>(null);
  const [tabBarOverflowing, setTabBarOverflowing] = useState(false);
  const [tabOverflowMenuOpen, setTabOverflowMenuOpen] = useState(false);

  useEffect(() => {
    const el = tabBarRef.current;
    if (!el) {
      setTabBarOverflowing(false);
      return;
    }
    const check = () => setTabBarOverflowing(el.scrollWidth > el.clientWidth + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [openSessions.length]);

  useEffect(() => {
    if (!tabOverflowMenuOpen) return;
    const close = () => setTabOverflowMenuOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [tabOverflowMenuOpen]);

  const loadVpnAll = useVpnStore((s) => s.loadAll);
  const releaseVpnIfUnused = useVpnStore((s) => s.releaseIfUnused);
  const vpnEnsureUp = useVpnStore((s) => s.ensureVpnUp);

  const leftSidebarVisible = useSettingsStore((s) => s.leftSidebarVisible);
  const toggleLeftSidebar = useSettingsStore((s) => s.toggleLeftSidebar);
  const setLeftSidebarVisible = useSettingsStore((s) => s.setLeftSidebarVisible);
  const leftSidebarWidth = useSettingsStore((s) => s.leftSidebarWidth);
  const setLeftSidebarWidth = useSettingsStore((s) => s.setLeftSidebarWidth);
  const snippetsDrawerOpen = useSettingsStore((s) => s.snippetsDrawerOpen);
  const toggleSnippetsDrawer = useSettingsStore((s) => s.toggleSnippetsDrawer);
  const rightPanelVisible = useSettingsStore((s) => s.rightPanelVisible);
  const toggleRightPanel = useSettingsStore((s) => s.toggleRightPanel);
  const rightPanelWidth = useSettingsStore((s) => s.rightPanelWidth);
  const setRightPanelWidth = useSettingsStore((s) => s.setRightPanelWidth);
  const [isDraggingLeftPanel, setIsDraggingLeftPanel] = useState(false);
  const [isDraggingRightPanel, setIsDraggingRightPanel] = useState(false);

  const [selectedHostId, setSelectedHostId] = useState<string | null>(null);
  const [mainView, setMainView] = useState<MainView>({ type: "manage", tab: "hosts" });
  const [modal, setModal] = useState<ModalState>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportSummary | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [vpnGateHostId, setVpnGateHostId] = useState<string | null>(null);
  const [vpnGateError, setVpnGateError] = useState<{ hostId: string; message: string } | null>(null);

  useEffect(() => {
    Promise.all([loadAll(), loadVpnAll()]).catch((e) => setLoadError(String(e)));
  }, [loadAll, loadVpnAll]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;

      if (e.key.toLowerCase() === "w") {
        if (mainView.type === "session") {
          e.preventDefault();
          handleCloseTab(mainView.tabId);
        }
        return;
      }

      if (e.key.toLowerCase() === "b") {
        e.preventDefault();
        if (e.shiftKey) {
          toggleRightPanel();
        } else {
          toggleLeftSidebar();
        }
        return;
      }

      if (e.key === "Tab" && openSessions.length > 0) {
        e.preventDefault();
        const currentIndex =
          mainView.type === "session" ? openSessions.findIndex((s) => s.tabId === mainView.tabId) : -1;
        const delta = e.shiftKey ? -1 : 1;
        const nextIndex = (currentIndex + delta + openSessions.length) % openSessions.length;
        setMainView({ type: "session", tabId: openSessions[nextIndex].tabId });
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainView, openSessions]);

  const selectedHost = hosts.find((h) => h.id === selectedHostId) ?? null;

  const activeSession =
    mainView.type === "session" ? openSessions.find((s) => s.tabId === mainView.tabId) : undefined;
  // Look up the live host record rather than using the session's snapshot
  // (taken once, at connect time) so fields like last_connected_at stay
  // current after the connection completes.
  const contextHost =
    mainView.type === "session"
      ? (hosts.find((h) => h.id === activeSession?.host.id) ?? activeSession?.host ?? null)
      : mainView.type === "manage" && mainView.tab === "hosts"
        ? selectedHost
        : null;
  const contextHostSessionOpen = contextHost
    ? openSessions.some((s) => s.host.id === contextHost.id)
    : false;
  // The host tree stays visible while a session is focused (so you can open
  // another host without leaving it), but hides for the other 4 sidebar
  // destinations so they read as clean, single-purpose views.
  const showHostTree = mainView.type === "session" || (mainView.type === "manage" && mainView.tab === "hosts");

  // The single gate for "is it OK to talk to this host's network right
  // now" - every caller (double-click, right-click menu, the host panel's
  // buttons) must go through this so a host's assigned VPN always gets a
  // chance to connect (and this specific host gets its own route) first,
  // rather than each entry point needing its own copy of this check (a
  // host panel-only version of this used to exist and missed the
  // sidebar's double-click/context-menu paths). The actual gating logic
  // lives in vpnStore.ensureVpnUp so non-connection callers (Snippets'
  // "run on hosts", Quick Commands' one-off exec fallback) can reuse it
  // too - this wrapper only adds the inline busy/error UI state specific
  // to the Connect/SFTP buttons here.
  async function ensureVpnUp(host: Host): Promise<boolean> {
    if (!host.vpn_profile_id) return true;
    setVpnGateError(null);
    setVpnGateHostId(host.id);
    try {
      const result = await vpnEnsureUp(host);
      if (!result.ok) {
        setVpnGateError({ hostId: host.id, message: result.message ?? "Could not connect the VPN." });
        return false;
      }
      return true;
    } finally {
      setVpnGateHostId(null);
    }
  }

  async function handleConnect(host: Host) {
    // HostContextPanel's own Connect button disables itself once a session
    // is open, but every other path into this function (HostTree's
    // double-click and right-click "Connect", the Hosts grid's
    // double-click) calls this directly with no such check - so without
    // this guard here too, any of those would open a second, fully
    // redundant terminal session/tab to a host already connected instead
    // of just switching to the existing one. Scoped to "terminal"
    // specifically since SFTP sessions are allowed to coexist alongside
    // (or instead of) a terminal session for the same host.
    const existing = openSessions.find((s) => s.host.id === host.id && s.kind === "terminal");
    if (existing) {
      setMainView({ type: "session", tabId: existing.tabId });
      return;
    }
    if (!(await ensureVpnUp(host))) return;
    const tabId = openSession(host, "terminal");
    setMainView({ type: "session", tabId });
  }

  async function handleOpenSftp(host: Host) {
    if (!(await ensureVpnUp(host))) return;
    const tabId = openSession(host, "sftp");
    setMainView({ type: "session", tabId });
  }

  function handleCloseTab(tabId: string) {
    const closing = openSessions.find((s) => s.tabId === tabId);
    const remaining = openSessions.filter((s) => s.tabId !== tabId);
    closeSession(tabId);
    if (closing) {
      // Fire-and-forget: disconnects the VPN this session was using, but
      // only once nothing else (another open session) still needs it -
      // never blocks the tab from closing.
      releaseVpnIfUnused(closing.host.id);
    }
    if (mainView.type === "session" && mainView.tabId === tabId) {
      const fallback = remaining[remaining.length - 1];
      setMainView(fallback ? { type: "session", tabId: fallback.tabId } : { type: "manage", tab: "hosts" });
    }
  }

  // VSCode's own Activity Bar behavior: clicking the already-active item
  // toggles the Primary Side Bar; clicking a different one switches to it
  // and makes sure the sidebar is showing (so it doesn't seem to do nothing
  // if the sidebar was left hidden).
  function handleActivitySelect(tab: ManageTab) {
    if (mainView.type === "manage" && mainView.tab === tab) {
      toggleLeftSidebar();
    } else {
      setMainView({ type: "manage", tab });
      setLeftSidebarVisible(true);
    }
  }

  async function handleExportCsv() {
    setCsvError(null);
    try {
      const csv = await exportHostsCsv();
      const path = await save({
        title: "Export hosts to CSV",
        defaultPath: "connecthub-hosts.csv",
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (!path) return;
      await localWriteTextFile(path, csv);
    } catch (e) {
      setCsvError(String(e));
    }
  }

  async function handleImportCsv() {
    setCsvError(null);
    try {
      const path = await open({
        title: "Import hosts from CSV",
        multiple: false,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (!path || Array.isArray(path)) return;
      const content = await localReadTextFile(path);
      const summary = await importHostsCsv(content);
      setImportResult(summary);
    } catch (e) {
      setCsvError(String(e));
    }
  }

  function toggleGroupCollapsed(id: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const hostsGridQuery = hostsGridSearch.trim().toLowerCase();

  function hostMatchesGridSearch(host: Host): boolean {
    if (!hostsGridQuery) return true;
    return host.label.toLowerCase().includes(hostsGridQuery) || host.hostname.toLowerCase().includes(hostsGridQuery);
  }

  // A group stays visible while searching if any host anywhere inside it
  // (directly, or inside a nested subgroup) matches - mirrors
  // HostTree.tsx's own groupHasMatch, so a match several levels deep isn't
  // hidden along with its non-matching ancestors.
  function groupHasGridMatch(groupId: string): boolean {
    if (!hostsGridQuery) return true;
    if (hosts.some((h) => h.group_id === groupId && hostMatchesGridSearch(h))) return true;
    return groups.some((g) => g.parent_id === groupId && groupHasGridMatch(g.id));
  }

  // Recursively renders one level of the group tree as: each child group's
  // own header (folder icon, name, direct host count, expand toggle)
  // followed by its expanded contents, then that level's own direct hosts
  // as a trailing card grid - same group-then-hosts ordering HostTree.tsx
  // uses, degenerating to today's flat grid when there are no groups at
  // all. Expand/collapse state is local to this view, independent of
  // HostTree's own - they're different jobs (compact navigation vs. card
  // browsing) over the same data, not something that needs to stay synced.
  function renderGroupSection(parentId: string | null) {
    const { childGroups: allChildGroups, childHosts: allChildHosts } = getGroupChildren(groups, hosts, parentId);
    const childGroups = allChildGroups.filter((g) => groupHasGridMatch(g.id));
    const childHosts = allChildHosts.filter(hostMatchesGridSearch);

    return (
      <>
        {childGroups.map((group) => {
          const isCollapsed = !hostsGridQuery && collapsedGroups.has(group.id);
          const directCount = hosts.filter((h) => h.group_id === group.id).length;
          return (
            <div key={group.id} className="mb-3">
              <button
                type="button"
                onClick={() => toggleGroupCollapsed(group.id)}
                className="mb-2 flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-200 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <span className="w-3 shrink-0 text-xs text-slate-400">{isCollapsed ? "▸" : "▾"}</span>
                <NavIcon icon="folder" className="h-4 w-4 shrink-0 text-slate-400" />
                <span className="truncate">{group.name}</span>
                <span className="ml-auto shrink-0 text-xs font-normal text-slate-400">
                  {directCount} host{directCount === 1 ? "" : "s"}
                </span>
              </button>
              {!isCollapsed && (
                <div className="ml-5 border-l border-slate-200 pl-3 dark:border-slate-800">
                  {renderGroupSection(group.id)}
                </div>
              )}
            </div>
          );
        })}
        {childHosts.length > 0 && (
          <div className="mb-3 grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
            {childHosts.map((h) => (
              <HostCard
                key={h.id}
                host={h}
                isSelected={selectedHostId === h.id}
                isOpen={openSessions.some((s) => s.host.id === h.id)}
                onSelect={() => setSelectedHostId(h.id)}
                onConnect={() => handleConnect(h)}
              />
            ))}
          </div>
        )}
      </>
    );
  }

  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-100 dark:bg-slate-900">
        <p className="text-red-600 dark:text-red-400">{loadError}</p>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-100 dark:bg-slate-900">
        <p className="text-slate-500 dark:text-slate-400">Loading…</p>
      </div>
    );
  }

  return (
    <div className="flex h-full bg-slate-50 dark:bg-slate-900">
      <ActivityBar
        activeTab={mainView.type === "manage" ? mainView.tab : null}
        onSelect={(tab) => handleActivitySelect(tab as ManageTab)}
        leftSidebarVisible={leftSidebarVisible}
        onToggleSidebar={toggleLeftSidebar}
      />

      {showHostTree && (
        <>
        <aside
          style={{ width: leftSidebarVisible ? leftSidebarWidth : 0 }}
          aria-hidden={!leftSidebarVisible}
          className={`shrink-0 overflow-hidden border-r border-slate-200 dark:border-slate-800 dark:bg-slate-950 ${
            isDraggingLeftPanel ? "" : "transition-[width] duration-150 ease-out"
          }`}
        >
        <div className="flex h-full flex-col" style={{ width: leftSidebarWidth }}>
          <div className="flex gap-2 border-b border-slate-200 p-2 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setModal({ kind: "host" })}
              className="flex-1 rounded-lg bg-teal-600 shadow-sm px-2 py-1.5 text-xs font-medium text-white hover:bg-teal-700"
            >
              + Host
            </button>
            <button
              type="button"
              onClick={() => setModal({ kind: "group" })}
              className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              + Group
            </button>
          </div>
          <div className="flex gap-2 border-b border-slate-200 p-2 dark:border-slate-800">
            <button
              type="button"
              onClick={handleExportCsv}
              title="Export all hosts to a CSV file"
              className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Export CSV
            </button>
            <button
              type="button"
              onClick={handleImportCsv}
              title="Import hosts from a CSV file"
              className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Import CSV
            </button>
          </div>
          {csvError && (
            <p className="border-b border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
              {csvError}
            </p>
          )}
          <div className="flex-1 overflow-y-auto p-2">
            <HostTree
              selectedHostId={selectedHostId}
              onSelectHost={(host) => {
                setSelectedHostId(host.id);
                setMainView({ type: "manage", tab: "hosts" });
              }}
              onConnectHost={(host) => {
                setSelectedHostId(host.id);
                handleConnect(host);
              }}
              onEditGroup={(group) => setModal({ kind: "group", group })}
              onEditHost={(host) => setModal({ kind: "host", host })}
              onNewHost={(groupId) => setModal({ kind: "host", groupId })}
              onNewSubgroup={(parentId) => setModal({ kind: "group", parentId })}
            />
          </div>
        </div>
        </aside>
        {leftSidebarVisible && (
          <ResizeHandle
            panelSide="left"
            width={leftSidebarWidth}
            onResize={setLeftSidebarWidth}
            onReset={() => setLeftSidebarWidth(DEFAULT_LEFT_SIDEBAR_WIDTH)}
            onDragStateChange={setIsDraggingLeftPanel}
          />
        )}
        </>
      )}

      <main className="flex min-w-[320px] flex-1 flex-col overflow-hidden">
        {openSessions.length > 0 && (
          <div className="flex items-stretch border-b border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-950">
            {tabBarOverflowing && (
              <button
                type="button"
                onClick={() => tabBarRef.current?.scrollBy({ left: -160, behavior: "smooth" })}
                title="Scroll tabs left"
                className="shrink-0 px-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <NavIcon icon="chevronLeft" className="h-4 w-4" />
              </button>
            )}
            <div
              ref={tabBarRef}
              className="flex flex-1 items-center gap-1 overflow-x-auto p-2"
              onDragOver={(e) => {
                if (!draggedTabId) return;
                e.preventDefault();
                setDragOverIndex(openSessions.length);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (!draggedTabId) return;
                const fromIndex = openSessions.findIndex((x) => x.tabId === draggedTabId);
                if (fromIndex !== -1) reorderSessions(fromIndex, openSessions.length - 1);
                setDraggedTabId(null);
                setDragOverIndex(null);
              }}
            >
              {openSessions.map((s, index) => {
                const active = mainView.type === "session" && mainView.tabId === s.tabId;
                // SFTP tabs don't report a connect/error lifecycle into
                // sessionsStore the way terminal tabs do - only style the dot
                // by real status for terminal sessions, otherwise fall back
                // to plain active/inactive coloring.
                const status = s.kind === "terminal" ? sessionStatuses[s.tabId] : undefined;
                const statusLabel =
                  status === "connected"
                    ? "Connected"
                    : status === "connecting"
                      ? "Connecting…"
                      : status === "error"
                        ? "Connection error"
                        : status === "closed"
                          ? "Session closed"
                          : undefined;
                const dotClass =
                  status === "connected"
                    ? "bg-emerald-500"
                    : status === "connecting"
                      ? "bg-amber-500 animate-pulse"
                      : status === "error"
                        ? "bg-red-500"
                        : active
                          ? "bg-emerald-500"
                          : "bg-slate-400 dark:bg-slate-600";
                return (
                  <Fragment key={s.tabId}>
                    {dragOverIndex === index && draggedTabId && draggedTabId !== s.tabId && (
                      <div className="h-6 w-0.5 shrink-0 self-center rounded bg-teal-500" />
                    )}
                    <div
                      draggable
                      onDragStart={() => setDraggedTabId(s.tabId)}
                      onDragEnd={() => {
                        setDraggedTabId(null);
                        setDragOverIndex(null);
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (draggedTabId && draggedTabId !== s.tabId) setDragOverIndex(index);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!draggedTabId || draggedTabId === s.tabId) return;
                        const fromIndex = openSessions.findIndex((x) => x.tabId === draggedTabId);
                        if (fromIndex !== -1) reorderSessions(fromIndex, index);
                        setDraggedTabId(null);
                        setDragOverIndex(null);
                      }}
                      className={`group flex shrink-0 items-center gap-2 rounded-t-md border-b-2 px-3 py-1.5 text-sm ${
                        active
                          ? "border-teal-500 bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-50"
                          : "border-transparent text-slate-500 hover:bg-slate-200/60 dark:text-slate-400 dark:hover:bg-slate-900/60"
                      } ${draggedTabId === s.tabId ? "opacity-40" : ""}`}
                    >
                      <button
                        type="button"
                        onClick={() => setMainView({ type: "session", tabId: s.tabId })}
                        title={statusLabel}
                        className="flex max-w-48 items-center gap-1.5 truncate"
                      >
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} />
                        {s.kind === "sftp" ? "📁 " : ""}
                        {s.host.label}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCloseTab(s.tabId)}
                        className="text-xs text-slate-400 opacity-0 hover:text-slate-700 group-hover:opacity-100 dark:hover:text-slate-200"
                        title="Close session"
                      >
                        ✕
                      </button>
                    </div>
                  </Fragment>
                );
              })}
              {dragOverIndex === openSessions.length && draggedTabId && (
                <div className="h-6 w-0.5 shrink-0 self-center rounded bg-teal-500" />
              )}
            </div>
            {tabBarOverflowing && (
              <>
                <button
                  type="button"
                  onClick={() => tabBarRef.current?.scrollBy({ left: 160, behavior: "smooth" })}
                  title="Scroll tabs right"
                  className="shrink-0 px-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                >
                  <NavIcon icon="chevronRight" className="h-4 w-4" />
                </button>
                <div className="relative shrink-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setTabOverflowMenuOpen((open) => !open);
                    }}
                    title="List all open tabs"
                    className="flex h-full items-center px-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                  >
                    ▾
                  </button>
                  {tabOverflowMenuOpen && (
                    <div
                      className="absolute right-0 top-full z-50 max-h-72 w-56 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-800"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {openSessions.map((s) => (
                        <button
                          key={s.tabId}
                          type="button"
                          onClick={() => {
                            setMainView({ type: "session", tabId: s.tabId });
                            setTabOverflowMenuOpen(false);
                          }}
                          className={`flex w-full items-center gap-1.5 truncate px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-700 ${
                            mainView.type === "session" && mainView.tabId === s.tabId
                              ? "text-teal-600 dark:text-teal-400"
                              : "text-slate-700 dark:text-slate-200"
                          }`}
                        >
                          {s.kind === "sftp" ? "📁 " : ""}
                          {s.host.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        <div className="relative flex-1 overflow-hidden">
          <div
            className={`absolute inset-0 overflow-y-auto p-6 ${
              mainView.type === "manage" ? "visible" : "invisible"
            }`}
          >
            {mainView.type === "manage" && mainView.tab === "hosts" && (
              hosts.length === 0 && groups.length === 0 ? (
                <p className="text-sm text-slate-400">
                  Select a host from the sidebar, or create a new one.
                </p>
              ) : (
                <>
                  <div className="mb-3 flex items-center gap-2">
                    <input
                      value={hostsGridSearch}
                      onChange={(e) => setHostsGridSearch(e.currentTarget.value)}
                      placeholder="Search hosts…"
                      className="w-64 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-teal-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                    {groups.length > 0 && (
                      <div className="ml-auto flex shrink-0 gap-2 text-xs">
                        <button
                          type="button"
                          onClick={() => setCollapsedGroups(new Set())}
                          className="rounded-lg border border-slate-300 px-2 py-1 font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                          Expand all
                        </button>
                        <button
                          type="button"
                          onClick={() => setCollapsedGroups(new Set(groups.map((g) => g.id)))}
                          className="rounded-lg border border-slate-300 px-2 py-1 font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                          Collapse all
                        </button>
                      </div>
                    )}
                  </div>
                  <p className="mb-3 text-xs text-slate-400">
                    Click to select, double-click to connect.
                  </p>
                  {hostsGridQuery && !hosts.some(hostMatchesGridSearch) ? (
                    <p className="text-sm text-slate-400">No hosts match "{hostsGridSearch.trim()}".</p>
                  ) : (
                    renderGroupSection(null)
                  )}
                </>
              )
            )}
            {mainView.type === "manage" && mainView.tab === "identities" && (
              <IdentitiesPanel
                onNew={() => setModal({ kind: "identity" })}
                onEdit={(identity) => setModal({ kind: "identity", identity })}
              />
            )}
            {mainView.type === "manage" && mainView.tab === "keys" && (
              <KeysPanel onNew={() => setModal({ kind: "key" })} />
            )}
            {mainView.type === "manage" && mainView.tab === "vpn" && (
              <VpnPanel
                onNew={() => setModal({ kind: "vpn-profile" })}
                onEdit={(profile) => setModal({ kind: "vpn-profile", profile })}
              />
            )}
            {mainView.type === "manage" && mainView.tab === "backup" && <BackupPanel />}
            {mainView.type === "manage" && mainView.tab === "settings" && <SettingsPanel />}
          </div>

          {/* Every open session stays mounted so its SSH connection and
              scrollback survive switching tabs. Uses visibility rather than
              display:none - xterm.js's renderer stops painting rows (and can
              drop the most recent one) when its container collapses to a
              display:none 0x0 box; visibility:hidden keeps the layout box
              (and painting) alive so nothing is lost when switching back. */}
          {openSessions.map((s) => (
            <div
              key={s.tabId}
              className={`absolute inset-0 ${
                mainView.type === "session" && mainView.tabId === s.tabId ? "visible" : "invisible"
              }`}
            >
              {s.kind === "terminal" ? (
                <TerminalView host={s.host} tabId={s.tabId} onClose={() => handleCloseTab(s.tabId)} />
              ) : (
                <SftpBrowser host={s.host} onClose={() => handleCloseTab(s.tabId)} />
              )}
            </div>
          ))}
        </div>
      </main>

      {rightPanelVisible && (
        <ResizeHandle
          panelSide="right"
          width={rightPanelWidth}
          onResize={setRightPanelWidth}
          onReset={() => setRightPanelWidth(DEFAULT_RIGHT_PANEL_WIDTH)}
          onDragStateChange={setIsDraggingRightPanel}
        />
      )}
      <div
        style={{ width: rightPanelVisible ? rightPanelWidth : 0 }}
        aria-hidden={!rightPanelVisible}
        className={`shrink-0 overflow-hidden ${
          isDraggingRightPanel ? "" : "transition-[width] duration-150 ease-out"
        }`}
      >
        <div style={{ width: rightPanelWidth }}>
          {snippetsDrawerOpen ? (
            <SnippetsDrawer
              onNew={() => setModal({ kind: "snippet" })}
              onEdit={(snippet) => setModal({ kind: "snippet", snippet })}
              onRun={(snippet) => setModal({ kind: "run-snippet", snippet })}
              onClose={toggleSnippetsDrawer}
            />
          ) : (
            contextHost && (
              <HostContextPanel
                host={contextHost}
                sessionOpen={contextHostSessionOpen}
                vpnBusy={vpnGateHostId === contextHost.id}
                vpnError={vpnGateError?.hostId === contextHost.id ? vpnGateError.message : null}
                onConnect={() => handleConnect(contextHost)}
                onOpenSftp={() => handleOpenSftp(contextHost)}
              />
            )
          )}
        </div>
      </div>

      <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-l border-slate-200 bg-slate-100 py-2 dark:border-slate-800 dark:bg-slate-950">
        <button
          type="button"
          title={rightPanelVisible ? "Hide details" : "Show details"}
          aria-label={rightPanelVisible ? "Hide details" : "Show details"}
          onClick={toggleRightPanel}
          className="flex h-8 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <NavIcon icon={sidebarToggleIcon("right", rightPanelVisible)} className="h-4 w-4" />
        </button>
        <button
          type="button"
          title={snippetsDrawerOpen ? "Hide Snippets" : "Show Snippets"}
          aria-label={snippetsDrawerOpen ? "Hide Snippets" : "Show Snippets"}
          onClick={toggleSnippetsDrawer}
          className={`flex h-10 w-10 items-center justify-center rounded-lg ${
            snippetsDrawerOpen
              ? "bg-teal-600 text-white"
              : "text-slate-500 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-800"
          }`}
        >
          <NavIcon icon="snippets" className="h-5 w-5" />
        </button>
      </nav>

      {modal?.kind === "group" && (
        <Modal title={modal.group ? "Edit group" : "New group"} onClose={() => setModal(null)}>
          <GroupForm group={modal.group} defaultParentId={modal.parentId} onDone={() => setModal(null)} />
        </Modal>
      )}
      {modal?.kind === "host" && (
        <Modal title={modal.host ? "Edit host" : "New host"} onClose={() => setModal(null)}>
          <HostForm host={modal.host} defaultGroupId={modal.groupId} onDone={() => setModal(null)} />
        </Modal>
      )}
      {modal?.kind === "identity" && (
        <Modal title={modal.identity ? "Edit identity" : "New identity"} onClose={() => setModal(null)}>
          <IdentityForm identity={modal.identity} onDone={() => setModal(null)} />
        </Modal>
      )}
      {modal?.kind === "key" && (
        <Modal title="New SSH key" onClose={() => setModal(null)}>
          <KeyForm onDone={() => setModal(null)} />
        </Modal>
      )}
      {modal?.kind === "snippet" && (
        <Modal title={modal.snippet ? "Edit snippet" : "New snippet"} onClose={() => setModal(null)}>
          <SnippetForm snippet={modal.snippet} onDone={() => setModal(null)} />
        </Modal>
      )}
      {modal?.kind === "run-snippet" && (
        <Modal title={`Run "${modal.snippet.label}"`} onClose={() => setModal(null)}>
          <RunSnippetForm snippet={modal.snippet} onDone={() => setModal(null)} />
        </Modal>
      )}
      {modal?.kind === "vpn-profile" && (
        <Modal title={modal.profile ? "Edit VPN profile" : "New VPN profile"} onClose={() => setModal(null)}>
          <VpnProfileForm profile={modal.profile} onDone={() => setModal(null)} />
        </Modal>
      )}
      {importResult && (
        <Modal title="Import complete" onClose={() => setImportResult(null)}>
          <p className="mb-3 text-sm text-slate-700 dark:text-slate-300">
            {importResult.imported > 0 &&
              `Imported ${importResult.imported} new host${importResult.imported === 1 ? "" : "s"}.`}
            {importResult.imported > 0 && importResult.updated > 0 && " "}
            {importResult.updated > 0 &&
              `Updated ${importResult.updated} existing host${importResult.updated === 1 ? "" : "s"}.`}
            {importResult.imported === 0 && importResult.updated === 0 && "No hosts to import."}
          </p>
          {importResult.warnings.length > 0 && (
            <div className="mb-4 max-h-56 space-y-1.5 overflow-y-auto rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
              {importResult.warnings.map((w, i) => (
                <p key={i}>{w}</p>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => setImportResult(null)}
            className="w-full rounded-lg bg-teal-600 shadow-sm px-3 py-2 text-sm font-medium text-white hover:bg-teal-700"
          >
            Close
          </button>
        </Modal>
      )}
    </div>
  );
}
