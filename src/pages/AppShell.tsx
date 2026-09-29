import { Fragment, useEffect, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import ActivityBar from "../components/layout/ActivityBar";
import { NavIcon, sidebarToggleIcon } from "../components/common/navIcons";
import CommandPalette, {
  PaletteAction,
} from "../components/common/CommandPalette";
import ResizeHandle from "../components/common/ResizeHandle";
import { useHostContextMenu } from "../components/common/useHostContextMenu";
import HostTree from "../components/sidebar/HostTree";
import Modal from "../components/common/Modal";
import HostContextPanel from "../components/panels/HostContextPanel";
import InlineFormPanel, {
  isInlineFormModal,
} from "../components/panels/InlineFormPanel";
import HostCard from "../components/common/HostCard";
import IdentitiesPanel from "../components/panels/IdentitiesPanel";
import KeysPanel from "../components/panels/KeysPanel";
import SnippetsDrawer from "../components/panels/SnippetsDrawer";
import AiAssistantDrawer from "../components/panels/AiAssistantDrawer";
import SnippetForm from "../components/forms/SnippetForm";
import RunSnippetForm from "../components/forms/RunSnippetForm";
import VpnPanel from "../components/panels/VpnPanel";
import SettingsPanel from "../components/panels/SettingsPanel";
import BackupPanel from "../components/panels/BackupPanel";
import WorkspacesPanel from "../components/panels/WorkspacesPanel";
import PaneSplitView from "../components/terminal/PaneSplitView";
import SftpBrowser from "../components/sftp/SftpBrowser";
import {
  Group,
  Host,
  Identity,
  ImportSummary,
  localReadTextFile,
  localWriteTextFile,
  Snippet,
  VpnProfile,
  Workspace,
  workspaceListTabs,
} from "../lib/tauri-bridge";
import { getGroupChildren } from "../lib/groupTree";
import {
  collectLeaves,
  countLeaves,
  deserializeLayout,
  serializeLayout,
} from "../lib/paneTree";
import { useHostsStore } from "../state/hostsStore";
import { MAX_PANES, useSessionsStore } from "../state/sessionsStore";
import { useTagsStore } from "../state/tagsStore";
import { useVpnStore } from "../state/vpnStore";
import { useWorkspacesStore } from "../state/workspacesStore";
import {
  DEFAULT_LEFT_SIDEBAR_WIDTH,
  DEFAULT_RIGHT_PANEL_WIDTH,
  useSettingsStore,
} from "../state/settingsStore";
import { useNotifications } from "../components/common/Notifications";
import { Button, LoadingSpinner, Notice } from "../components/common/ui";

type ManageTab =
  | "hosts"
  | "identities"
  | "keys"
  | "vpn"
  | "workspaces"
  | "backup"
  | "settings";
type MainView =
  { type: "manage"; tab: ManageTab } | { type: "session"; tabId: string };

const SHELL_RAILS_WIDTH = 104;
const MIN_CENTER_WORKSPACE_WIDTH = 620;

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
  const notify = useNotifications();
  const loadAll = useHostsStore((s) => s.loadAll);
  const loaded = useHostsStore((s) => s.loaded);
  const hosts = useHostsStore((s) => s.hosts);
  const groups = useHostsStore((s) => s.groups);
  const identities = useHostsStore((s) => s.identities);
  const exportHostsCsv = useHostsStore((s) => s.exportHostsCsv);
  const importHostsCsv = useHostsStore((s) => s.importHostsCsv);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    new Set(),
  );
  const [hostsGridSearch, setHostsGridSearch] = useState("");
  // The same Connect/Duplicate/Edit/Delete menu HostTree.tsx's sidebar rows
  // already have, offered here too so right-click behaves identically
  // whether triggered from the sidebar or the center grid.
  const {
    openContextMenu: openGridContextMenu,
    menu: gridContextMenu,
    confirmDialog: gridContextMenuConfirmDialog,
    deleteError: gridDeleteError,
    handleDeleteHost: deleteGridHost,
  } = useHostContextMenu(
    (host) => {
      setSelectedHostId(host.id);
      handleConnect(host);
    },
    (host) => {
      setSelectedHostId(host.id);
      openModal({ kind: "host", host });
    },
  );

  const openSessions = useSessionsStore((s) => s.openSessions);
  const sessionStatuses = useSessionsStore((s) => s.statuses);
  const openSession = useSessionsStore((s) => s.openSession);
  const closeSession = useSessionsStore((s) => s.closeSession);
  const reorderSessions = useSessionsStore((s) => s.reorderSessions);
  const splitPane = useSessionsStore((s) => s.splitPane);
  const closePane = useSessionsStore((s) => s.closePane);
  const setLayout = useSessionsStore((s) => s.setLayout);
  const toggleBroadcast = useSessionsStore((s) => s.toggleBroadcast);
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
    const check = () =>
      setTabBarOverflowing(el.scrollWidth > el.clientWidth + 1);
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

  const loadTagsAll = useTagsStore((s) => s.loadAll);
  const loadVpnAll = useVpnStore((s) => s.loadAll);
  const loadWorkspacesAll = useWorkspacesStore((s) => s.loadAll);
  const createWorkspace = useWorkspacesStore((s) => s.createWorkspace);
  const releaseVpnIfUnused = useVpnStore((s) => s.releaseIfUnused);
  const vpnEnsureUp = useVpnStore((s) => s.ensureVpnUp);

  const leftSidebarVisible = useSettingsStore((s) => s.leftSidebarVisible);
  const toggleLeftSidebar = useSettingsStore((s) => s.toggleLeftSidebar);
  const setLeftSidebarVisible = useSettingsStore(
    (s) => s.setLeftSidebarVisible,
  );
  const leftSidebarWidth = useSettingsStore((s) => s.leftSidebarWidth);
  const setLeftSidebarWidth = useSettingsStore((s) => s.setLeftSidebarWidth);
  const snippetsDrawerOpen = useSettingsStore((s) => s.snippetsDrawerOpen);
  const toggleSnippetsDrawer = useSettingsStore((s) => s.toggleSnippetsDrawer);
  const aiPanelOpen = useSettingsStore((s) => s.aiPanelOpen);
  const toggleAiPanel = useSettingsStore((s) => s.toggleAiPanel);
  const rightPanelVisible = useSettingsStore((s) => s.rightPanelVisible);
  const toggleRightPanel = useSettingsStore((s) => s.toggleRightPanel);
  const setRightPanelVisible = useSettingsStore((s) => s.setRightPanelVisible);
  const rightPanelWidth = useSettingsStore((s) => s.rightPanelWidth);
  const setRightPanelWidth = useSettingsStore((s) => s.setRightPanelWidth);
  const [isDraggingLeftPanel, setIsDraggingLeftPanel] = useState(false);
  const [isDraggingRightPanel, setIsDraggingRightPanel] = useState(false);
  const [selectedHostId, setSelectedHostId] = useState<string | null>(null);
  const [mainView, setMainView] = useState<MainView>({
    type: "manage",
    tab: "hosts",
  });
  const [modal, setModal] = useState<ModalState>(null);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [activeOverlay, setActiveOverlay] = useState<"left" | "right" | null>(
    null,
  );
  const leftPanelOverlays =
    viewportWidth <
    Math.max(
      900,
      leftSidebarWidth + SHELL_RAILS_WIDTH + MIN_CENTER_WORKSPACE_WIDTH,
    );
  const rightPanelOverlays =
    viewportWidth <
    Math.max(
      1280,
      leftSidebarWidth +
        rightPanelWidth +
        SHELL_RAILS_WIDTH +
        MIN_CENTER_WORKSPACE_WIDTH,
    );

  useEffect(() => {
    const update = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    if (!rightPanelOverlays) setActiveOverlay(null);
    else if (isInlineFormModal(modal)) setActiveOverlay("right");
  }, [rightPanelOverlays, modal]);

  useEffect(() => {
    if (!activeOverlay) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveOverlay(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [activeOverlay]);

  // Host/Group/Identity/Key/VpnProfile forms render inline in the right
  // panel (InlineFormPanel), so opening one of those also makes sure the
  // panel is actually visible - Snippet/RunSnippet modals don't need this,
  // hence checking isInlineFormModal rather than doing this in setModal
  // itself.
  function openModal(state: ModalState) {
    setModal(state);
    if (isInlineFormModal(state)) {
      setRightPanelVisible(true);
      if (rightPanelOverlays) setActiveOverlay("right");
    }
  }

  function closeInlineForm() {
    setModal(null);
    if (rightPanelOverlays) setActiveOverlay(null);
  }
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportSummary | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [vpnGateHostId, setVpnGateHostId] = useState<string | null>(null);
  const [vpnGateError, setVpnGateError] = useState<{
    hostId: string;
    message: string;
  } | null>(null);

  useEffect(() => {
    Promise.all([
      loadAll(),
      loadVpnAll(),
      loadTagsAll(),
      loadWorkspacesAll(),
    ]).catch((e) => setLoadError(String(e)));
  }, [loadAll, loadVpnAll, loadTagsAll, loadWorkspacesAll]);

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

      if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
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
          mainView.type === "session"
            ? openSessions.findIndex((s) => s.tabId === mainView.tabId)
            : -1;
        const delta = e.shiftKey ? -1 : 1;
        const nextIndex =
          (currentIndex + delta + openSessions.length) % openSessions.length;
        setMainView({ type: "session", tabId: openSessions[nextIndex].tabId });
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainView, openSessions]);

  const selectedHost = hosts.find((h) => h.id === selectedHostId) ?? null;

  const activeSession =
    mainView.type === "session"
      ? openSessions.find((s) => s.tabId === mainView.tabId)
      : undefined;
  // Look up the live host record rather than using the session's snapshot
  // (taken once, at connect time) so fields like last_connected_at stay
  // current after the connection completes.
  const contextHost =
    mainView.type === "session"
      ? (hosts.find((h) => h.id === activeSession?.host.id) ??
        activeSession?.host ??
        null)
      : mainView.type === "manage" && mainView.tab === "hosts"
        ? selectedHost
        : null;
  const contextHostSessionOpen = contextHost
    ? openSessions.some((s) => s.host.id === contextHost.id)
    : false;
  const dockedPanelVisible =
    rightPanelVisible &&
    (isInlineFormModal(modal) || snippetsDrawerOpen || contextHost !== null);
  // The host tree stays visible while a session is focused (so you can open
  // another host without leaving it), but hides for the other 4 sidebar
  // destinations so they read as clean, single-purpose views.
  const showHostTree =
    mainView.type === "session" ||
    (mainView.type === "manage" && mainView.tab === "hosts");
  const leftPanelOpen =
    showHostTree &&
    leftSidebarVisible &&
    (!leftPanelOverlays || activeOverlay === "left");
  const rightPanelOpen =
    dockedPanelVisible && (!rightPanelOverlays || activeOverlay === "right");

  function handleLeftPanelToggle() {
    if (!leftPanelOverlays) {
      toggleLeftSidebar();
      return;
    }
    if (!leftSidebarVisible) setLeftSidebarVisible(true);
    setActiveOverlay((current) => (current === "left" ? null : "left"));
  }

  function handleRightPanelToggle() {
    if (!rightPanelOverlays) {
      toggleRightPanel();
      return;
    }
    if (!rightPanelVisible) setRightPanelVisible(true);
    setActiveOverlay((current) => (current === "right" ? null : "right"));
  }

  function handleSnippetsToggle() {
    if (!snippetsDrawerOpen) setRightPanelVisible(true);
    toggleSnippetsDrawer();
    if (rightPanelOverlays) {
      setRightPanelVisible(true);
      setActiveOverlay(
        snippetsDrawerOpen && activeOverlay === "right" ? null : "right",
      );
    }
  }

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
  async function ensureVpnUp(
    host: Host,
  ): Promise<{ ok: boolean; message?: string }> {
    if (!host.vpn_profile_id) return { ok: true };
    setVpnGateError(null);
    setVpnGateHostId(host.id);
    try {
      const result = await vpnEnsureUp(host);
      if (!result.ok) {
        const message = result.message ?? "Could not connect the VPN.";
        setVpnGateError({ hostId: host.id, message });
        return { ok: false, message };
      }
      return { ok: true };
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
    // (or instead of) a terminal session for the same host. Reads fresh
    // from the store rather than the component's own `openSessions` -
    // handleOpenWorkspace calls this repeatedly in a tight loop with
    // `await`s in between, and the closure over this render's
    // `openSessions` would otherwise still show the state from before any
    // of those awaited opens actually landed.
    const existing = useSessionsStore
      .getState()
      .openSessions.find((s) => s.host.id === host.id && s.kind === "terminal");
    if (existing) {
      setMainView({ type: "session", tabId: existing.tabId });
      // Auto-hide so the terminal gets the room, matching a brand-new
      // connect below - never touch rightPanelVisible here, so a manually
      // hidden right panel stays hidden rather than being forced back open.
      setLeftSidebarVisible(false);
      setActiveOverlay(null);
      return;
    }
    if (!(await ensureVpnUp(host)).ok) return;
    const tabId = openSession(host, "terminal");
    setMainView({ type: "session", tabId });
    setLeftSidebarVisible(false);
    setActiveOverlay(null);
  }

  async function handleOpenSftp(host: Host) {
    if (!(await ensureVpnUp(host)).ok) return;
    const tabId = openSession(host, "sftp");
    setMainView({ type: "session", tabId });
    setLeftSidebarVisible(false);
    setActiveOverlay(null);
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
      setMainView(
        fallback
          ? { type: "session", tabId: fallback.tabId }
          : { type: "manage", tab: "hosts" },
      );
    }
  }

  // Splitting a pane defaults to the same host it's splitting from, but the
  // Split popover (TerminalView.tsx) lets the user pick a different one -
  // still goes through the shared VPN gate (ensureVpnUp), gating whichever
  // host the *new* pane actually connects to (not necessarily the tab's
  // own host). Reads fresh from the store for the same reason as
  // handleConnect's `existing` lookup above - handleOpenWorkspace calls
  // this in a loop across several awaits.
  async function handleSplitPane(
    tabId: string,
    paneId: string,
    direction: "row" | "column",
    host?: Host,
  ): Promise<{ ok: boolean; message?: string }> {
    const session = useSessionsStore
      .getState()
      .openSessions.find((s) => s.tabId === tabId);
    if (!session?.layout)
      return { ok: false, message: "This tab is no longer open." };
    const leaf = collectLeaves(session.layout).find((l) => l.paneId === paneId);
    const targetHost = host ?? leaf?.host;
    if (!targetHost)
      return { ok: false, message: "This pane is no longer open." };
    const gate = await ensureVpnUp(targetHost);
    if (!gate.ok) return gate;
    if (splitPane(tabId, paneId, direction, host) === null) {
      return { ok: false, message: `Up to ${MAX_PANES} panes per tab.` };
    }
    return { ok: true };
  }

  // A pane's own "Close" button reads as "close the tab" when it's the
  // tab's only pane (matching every single-pane tab's existing behavior),
  // and as "close just this pane" once there's more than one.
  function handleClosePane(tabId: string, paneId: string) {
    const session = openSessions.find((s) => s.tabId === tabId);
    if (!session?.layout || countLeaves(session.layout) <= 1) {
      handleCloseTab(tabId);
      return;
    }
    closePane(tabId, paneId);
  }

  // Captures exactly what's open right now - host, kind, and pane count per
  // tab - as a named snapshot. Not an auto-restored session: reopening it
  // later is always an explicit "Open" click (see WorkspacesPanel.tsx).
  async function handleSaveCurrentLayout(label: string) {
    await createWorkspace(
      label,
      openSessions.map((s, i) => ({
        host_id: s.host.id,
        kind: s.kind,
        pane_count:
          s.kind === "terminal" && s.layout ? countLeaves(s.layout) : 1,
        layout_json:
          s.kind === "terminal" && s.layout
            ? JSON.stringify(serializeLayout(s.layout))
            : null,
        sort_order: i,
      })),
    );
    notify("Workspace saved.", "success");
  }

  // Replays a saved workspace's tabs through the exact same handleConnect/
  // handleOpenSftp/handleSplitPane paths every other entry point uses, so VPN
  // gating and the duplicate-tab guard apply automatically rather than
  // needing a parallel connect flow here. A tab whose host was deleted
  // since the workspace was saved is silently skipped - the CASCADE on
  // workspace_tabs.host_id already dropped its row backend-side.
  async function handleOpenWorkspace(workspace: Workspace) {
    const tabs = await workspaceListTabs(workspace.id);
    for (const tab of [...tabs].sort((a, b) => a.sort_order - b.sort_order)) {
      const host = hosts.find((h) => h.id === tab.host_id);
      if (!host) continue;
      if (tab.kind === "sftp") {
        await handleOpenSftp(host);
        continue;
      }
      await handleConnect(host);
      const openedTabId = useSessionsStore
        .getState()
        .openSessions.find(
          (s) => s.host.id === host.id && s.kind === "terminal",
        )?.tabId;
      if (!openedTabId) continue;

      const restoredLayout = tab.layout_json
        ? deserializeLayout(
            JSON.parse(tab.layout_json),
            new Map(hosts.map((h) => [h.id, h])),
          )
        : null;
      if (restoredLayout) {
        // Gate every distinct host referenced anywhere in the restored
        // tree before applying it - setLayout below replaces the whole
        // tree in one shot, bypassing handleSplitPane's own per-split
        // gating.
        const distinctHosts = new Map(
          collectLeaves(restoredLayout).map((leaf) => [
            leaf.host.id,
            leaf.host,
          ]),
        );
        for (const h of distinctHosts.values()) {
          if (h.id !== host.id) await ensureVpnUp(h); // best-effort, same as every other host in this loop
        }
        setLayout(openedTabId, restoredLayout);
        continue;
      }

      // No layout_json (workspace saved before this existed) - fall back
      // to pane_count flat panes on the tab's single saved host, exactly
      // the old behavior.
      for (let i = 1; i < tab.pane_count; i++) {
        const current = useSessionsStore
          .getState()
          .openSessions.find((s) => s.tabId === openedTabId);
        const firstLeaf = current?.layout
          ? collectLeaves(current.layout)[0]
          : undefined;
        if (!firstLeaf) break;
        await handleSplitPane(openedTabId, firstLeaf.paneId, "row");
      }
    }
  }

  // VSCode's own Activity Bar behavior: clicking the already-active item
  // toggles the Primary Side Bar; clicking a different one switches to it
  // and makes sure the sidebar is showing (so it doesn't seem to do nothing
  // if the sidebar was left hidden).
  function handleActivitySelect(tab: ManageTab) {
    if (mainView.type === "manage" && mainView.tab === tab) {
      if (tab === "hosts") handleLeftPanelToggle();
    } else {
      setMainView({ type: "manage", tab });
      if (tab === "hosts") {
        setLeftSidebarVisible(true);
        setActiveOverlay(leftPanelOverlays ? "left" : null);
      } else {
        setActiveOverlay(null);
      }
    }
  }

  // Static navigation/creation actions for the Ctrl/Cmd+K command palette -
  // host quick-open is handled separately inside CommandPalette itself
  // (it needs live host search, not a fixed list). "New Host"/"New Group"
  // go through the same openModal used by every other "+ New" entry point
  // so the inline form panel opens exactly the way it already does
  // elsewhere.
  const paletteActions: PaletteAction[] = [
    {
      id: "new-host",
      label: "New Host",
      run: () => openModal({ kind: "host" }),
    },
    {
      id: "new-group",
      label: "New Group",
      run: () => openModal({ kind: "group" }),
    },
    {
      id: "go-hosts",
      label: "Go to Hosts",
      run: () => handleActivitySelect("hosts"),
    },
    {
      id: "go-identities",
      label: "Go to Identities",
      run: () => handleActivitySelect("identities"),
    },
    {
      id: "go-keys",
      label: "Go to Keys",
      run: () => handleActivitySelect("keys"),
    },
    {
      id: "go-vpn",
      label: "Go to VPN",
      run: () => handleActivitySelect("vpn"),
    },
    {
      id: "go-workspaces",
      label: "Go to Workspaces",
      run: () => handleActivitySelect("workspaces"),
    },
    {
      id: "go-backup",
      label: "Go to Backup",
      run: () => handleActivitySelect("backup"),
    },
    {
      id: "go-settings",
      label: "Go to Settings (Known Hosts, etc.)",
      run: () => handleActivitySelect("settings"),
    },
    {
      id: "toggle-snippets",
      label: "Toggle Snippets panel",
      run: handleSnippetsToggle,
    },
  ];

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
      notify("Hosts exported successfully.", "success");
    } catch (e) {
      setCsvError(String(e));
      notify("Hosts could not be exported.", "error");
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
      notify("Host import completed.", "success");
    } catch (e) {
      setCsvError(String(e));
      notify("Hosts could not be imported.", "error");
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
    const identity = identities.find(
      (candidate) => candidate.id === host.identity_id,
    );
    return (
      host.label.toLowerCase().includes(hostsGridQuery) ||
      host.hostname.toLowerCase().includes(hostsGridQuery) ||
      identity?.username.toLowerCase().includes(hostsGridQuery) ||
      host.tags.some((t) => t.label.toLowerCase().includes(hostsGridQuery))
    );
  }

  // A group stays visible while searching if any host anywhere inside it
  // (directly, or inside a nested subgroup) matches - mirrors
  // HostTree.tsx's own groupHasMatch, so a match several levels deep isn't
  // hidden along with its non-matching ancestors.
  function groupHasGridMatch(groupId: string): boolean {
    if (!hostsGridQuery) return true;
    if (hosts.some((h) => h.group_id === groupId && hostMatchesGridSearch(h)))
      return true;
    return groups.some(
      (g) => g.parent_id === groupId && groupHasGridMatch(g.id),
    );
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
    const { childGroups: allChildGroups, childHosts: allChildHosts } =
      getGroupChildren(groups, hosts, parentId);
    const childGroups = allChildGroups.filter((g) => groupHasGridMatch(g.id));
    const childHosts = allChildHosts.filter(hostMatchesGridSearch);

    return (
      <>
        {childGroups.map((group) => {
          const isCollapsed = !hostsGridQuery && collapsedGroups.has(group.id);
          const directCount = hosts.filter(
            (h) => h.group_id === group.id,
          ).length;
          return (
            <section key={group.id} className="mb-4">
              <button
                type="button"
                onClick={() => toggleGroupCollapsed(group.id)}
                className="mb-2 flex w-full items-center gap-2 rounded-xl px-1 py-1 text-left text-xs font-bold uppercase tracking-[0.12em] text-slate-500 hover:text-teal-600 dark:text-slate-400 dark:hover:text-teal-300"
              >
                <span className="w-3 shrink-0 text-xs text-slate-400">
                  {isCollapsed ? "▸" : "▾"}
                </span>
                <NavIcon
                  icon="folder"
                  className="h-4 w-4 shrink-0 text-teal-400"
                />
                <span className="truncate">{group.name}</span>
                <span className="ml-auto shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold tracking-normal text-slate-400 dark:bg-slate-800">
                  {directCount} host{directCount === 1 ? "" : "s"}
                </span>
              </button>
              {!isCollapsed && (
                <div className="ml-1 border-l border-slate-200 pl-4 dark:border-slate-800">
                  {renderGroupSection(group.id)}
                </div>
              )}
            </section>
          );
        })}
        {childHosts.length > 0 && (
          <>
            {parentId === null && groups.length > 0 && (
              <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                Ungrouped
              </h2>
            )}
            <div className="server-card-grid mb-4">
              {childHosts.map((h) => (
                <HostCard
                  key={h.id}
                  host={h}
                  identity={identities.find(
                    (identity) => identity.id === h.identity_id,
                  )}
                  isSelected={selectedHostId === h.id}
                  isOpen={openSessions.some((s) => s.host.id === h.id)}
                  onSelect={() => setSelectedHostId(h.id)}
                  onConnect={() => handleConnect(h)}
                  onEdit={() => {
                    setSelectedHostId(h.id);
                    openModal({ kind: "host", host: h });
                  }}
                  onDelete={() => deleteGridHost(h)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSelectedHostId(h.id);
                    openGridContextMenu(h, e);
                  }}
                />
              ))}
            </div>
          </>
        )}
      </>
    );
  }

  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-50 p-6 dark:bg-slate-950">
        <Notice intent="error" className="max-w-lg">
          {loadError}
        </Notice>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div
          role="status"
          className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-400"
        >
          <LoadingSpinner className="h-5 w-5 text-teal-600" /> Loading
          workspace…
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full overflow-hidden bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <ActivityBar
        activeTab={mainView.type === "manage" ? mainView.tab : null}
        onSelect={(tab) => handleActivitySelect(tab as ManageTab)}
        leftSidebarVisible={leftPanelOpen}
        onToggleSidebar={handleLeftPanelToggle}
      />

      {showHostTree && (
        <>
          <aside
            style={{ width: leftPanelOpen ? leftSidebarWidth : 0 }}
            aria-hidden={!leftPanelOpen}
            className={`${leftPanelOverlays ? "absolute inset-y-0 left-[52px] z-40 shadow-2xl" : "relative shrink-0"} overflow-hidden border-r border-slate-200 bg-white/95 backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/95 ${
              isDraggingLeftPanel
                ? ""
                : "transition-[width] duration-150 ease-out"
            }`}
          >
            <div
              className="flex h-full flex-col"
              style={{ width: leftSidebarWidth }}
            >
              <div className="border-b border-slate-200 p-3 dark:border-slate-800">
                <p className="mb-2 px-1 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                  Connection library
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => openModal({ kind: "host" })}
                    className="flex-1 rounded-lg bg-teal-600 px-2 py-2 text-xs font-bold text-white shadow-sm shadow-slate-950/10 hover:bg-teal-700"
                  >
                    + Host
                  </button>
                  <button
                    type="button"
                    onClick={() => openModal({ kind: "group" })}
                    className="flex-1 rounded-xl border border-slate-200 bg-white px-2 py-2 text-xs font-bold text-slate-600 shadow-sm hover:border-teal-300 hover:text-teal-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                  >
                    + Group
                  </button>
                </div>
              </div>
              <div className="flex gap-2 border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">
                <button
                  type="button"
                  onClick={handleExportCsv}
                  title="Export all hosts to a CSV file"
                  className="flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-teal-600 dark:text-slate-400 dark:hover:bg-slate-800"
                >
                  Export CSV
                </button>
                <button
                  type="button"
                  onClick={handleImportCsv}
                  title="Import hosts from a CSV file"
                  className="flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-teal-600 dark:text-slate-400 dark:hover:bg-slate-800"
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
                  onEditGroup={(group) => openModal({ kind: "group", group })}
                  onEditHost={(host) => {
                    setSelectedHostId(host.id);
                    openModal({ kind: "host", host });
                  }}
                  onNewHost={(groupId) => openModal({ kind: "host", groupId })}
                  onNewSubgroup={(parentId) =>
                    openModal({ kind: "group", parentId })
                  }
                />
              </div>
            </div>
          </aside>
          {leftPanelOpen && !leftPanelOverlays && (
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

      {activeOverlay && (leftPanelOpen || rightPanelOpen) && (
        <button
          type="button"
          aria-label="Close panel"
          onClick={() => setActiveOverlay(null)}
          className="absolute inset-0 z-30 bg-slate-950/35 backdrop-blur-[1px]"
        />
      )}

      <main className="flex min-w-[320px] flex-1 flex-col overflow-hidden">
        {openSessions.length > 0 && (
          <div className="flex min-h-10 items-stretch border-b border-slate-200 bg-white px-1 dark:border-slate-800 dark:bg-slate-950">
            {tabBarOverflowing && (
              <button
                type="button"
                onClick={() =>
                  tabBarRef.current?.scrollBy({
                    left: -160,
                    behavior: "smooth",
                  })
                }
                title="Scroll tabs left"
                className="shrink-0 px-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <NavIcon icon="chevronLeft" className="h-4 w-4" />
              </button>
            )}
            <div
              ref={tabBarRef}
              className="flex flex-1 items-center gap-1.5 overflow-x-auto px-1 py-2"
              onDragOver={(e) => {
                if (!draggedTabId) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setDragOverIndex(openSessions.length);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (!draggedTabId) return;
                const fromIndex = openSessions.findIndex(
                  (x) => x.tabId === draggedTabId,
                );
                if (fromIndex !== -1)
                  reorderSessions(fromIndex, openSessions.length);
                setDraggedTabId(null);
                setDragOverIndex(null);
              }}
            >
              {openSessions.map((s, index) => {
                const active =
                  mainView.type === "session" && mainView.tabId === s.tabId;
                // SFTP tabs don't report a connect/error lifecycle into
                // sessionsStore the way terminal tabs do - only style the dot
                // by real status for terminal sessions, otherwise fall back
                // to plain active/inactive coloring. A split tab's dot
                // reflects its first (primary) pane specifically.
                const firstPaneId =
                  s.kind === "terminal" && s.layout
                    ? collectLeaves(s.layout)[0]?.paneId
                    : undefined;
                const status = firstPaneId
                  ? sessionStatuses[firstPaneId]
                  : undefined;
                const statusLabel =
                  status === "connected"
                    ? "Connected"
                    : status === "connecting"
                      ? "Connecting…"
                      : status === "reconnecting"
                        ? "Reconnecting…"
                        : status === "error"
                          ? "Connection error"
                          : status === "closed"
                            ? "Session closed"
                            : undefined;
                const dotClass =
                  status === "connected"
                    ? "bg-emerald-500"
                    : status === "connecting" || status === "reconnecting"
                      ? "bg-amber-500 animate-pulse"
                      : status === "error"
                        ? "bg-red-500"
                        : active
                          ? "bg-emerald-500"
                          : "bg-slate-400 dark:bg-slate-600";
                return (
                  <Fragment key={s.tabId}>
                    {dragOverIndex === index &&
                      draggedTabId &&
                      draggedTabId !== s.tabId && (
                        <div className="h-7 w-0.5 shrink-0 self-center rounded bg-teal-500" />
                      )}
                    <div
                      draggable
                      onDragStart={(e) => {
                        setDraggedTabId(s.tabId);
                        // Required by WebKitGTK to start the drag at all -
                        // Chromium tolerates the absence of setData, WebKit
                        // silently refuses to complete the drag session
                        // without it. The value itself is unused by any
                        // onDrop handler here (all lookups go through the
                        // draggedTabId state instead).
                        e.dataTransfer.setData("text/plain", s.tabId);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => {
                        setDraggedTabId(null);
                        setDragOverIndex(null);
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        e.dataTransfer.dropEffect = "move";
                        if (draggedTabId && draggedTabId !== s.tabId)
                          setDragOverIndex(index);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!draggedTabId || draggedTabId === s.tabId) return;
                        const fromIndex = openSessions.findIndex(
                          (x) => x.tabId === draggedTabId,
                        );
                        if (fromIndex !== -1) reorderSessions(fromIndex, index);
                        setDraggedTabId(null);
                        setDragOverIndex(null);
                      }}
                      className={`group flex shrink-0 items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${
                        active
                          ? "border-teal-200 bg-teal-50 text-teal-950 shadow-sm dark:border-teal-900 dark:bg-teal-950/60 dark:text-teal-100"
                          : "border-transparent text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-900"
                      } ${draggedTabId === s.tabId ? "opacity-40" : ""}`}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setMainView({ type: "session", tabId: s.tabId })
                        }
                        title={statusLabel}
                        className="flex max-w-48 items-center gap-1.5 truncate"
                      >
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`}
                        />
                        {s.kind === "sftp" && (
                          <NavIcon icon="folder" className="h-3.5 w-3.5" />
                        )}
                        {s.host.label}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCloseTab(s.tabId)}
                        className="text-xs text-slate-400 opacity-0 hover:text-slate-700 group-hover:opacity-100 dark:hover:text-slate-200"
                        title="Close session"
                      >
                        <NavIcon icon="close" className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </Fragment>
                );
              })}
              {dragOverIndex === openSessions.length && draggedTabId && (
                <div className="h-7 w-0.5 shrink-0 self-center rounded bg-teal-500" />
              )}
            </div>
            {tabBarOverflowing && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    tabBarRef.current?.scrollBy({
                      left: 160,
                      behavior: "smooth",
                    })
                  }
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
                    <NavIcon icon="chevronDown" className="h-4 w-4" />
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
                            mainView.type === "session" &&
                            mainView.tabId === s.tabId
                              ? "text-teal-600 dark:text-teal-400"
                              : "text-slate-700 dark:text-slate-200"
                          }`}
                        >
                          {s.kind === "sftp" && (
                            <NavIcon icon="folder" className="h-3.5 w-3.5" />
                          )}
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
            className={`absolute inset-0 overflow-y-auto p-3 sm:p-4 xl:p-5 ${
              mainView.type === "manage" ? "visible" : "invisible"
            }`}
          >
            {mainView.type === "manage" && mainView.tab === "hosts" && (
              <div className="server-workspace mx-auto w-full max-w-[1680px]">
                <header className="mb-4 flex flex-wrap items-center gap-3">
                  <div className="mr-auto min-w-48">
                    <h1 className="text-xl font-bold tracking-tight text-slate-950 dark:text-white">
                      Servers
                    </h1>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {hosts.length === 0
                        ? "Add your first server to connect over SSH."
                        : `${hosts.length} saved server${hosts.length === 1 ? "" : "s"}`}
                    </p>
                  </div>

                  <div className="relative min-w-52 flex-1 sm:max-w-72">
                    <svg
                      viewBox="0 0 20 20"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      aria-hidden="true"
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                    >
                      <circle cx="8.5" cy="8.5" r="5.5" />
                      <path d="m13 13 4 4" />
                    </svg>
                    <input
                      value={hostsGridSearch}
                      onChange={(e) =>
                        setHostsGridSearch(e.currentTarget.value)
                      }
                      placeholder="Search servers"
                      aria-label="Search servers"
                      className="min-h-9 w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 shadow-sm outline-none hover:border-slate-400 focus:border-teal-600 focus:ring-2 focus:ring-teal-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-600"
                    />
                  </div>

                  <Button
                    type="button"
                    onClick={() => openModal({ kind: "host" })}
                  >
                    + Add server
                  </Button>
                </header>

                {groups.length > 0 && hosts.length > 0 && (
                  <div className="mb-5 flex items-center justify-end gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setCollapsedGroups(new Set())}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-slate-500 hover:border-teal-300 hover:text-teal-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                    >
                      Expand all
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setCollapsedGroups(new Set(groups.map((g) => g.id)))
                      }
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-slate-500 hover:border-teal-300 hover:text-teal-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                    >
                      Collapse all
                    </button>
                  </div>
                )}

                {hosts.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 px-5 py-10 text-center dark:border-slate-700 dark:bg-slate-900/50">
                    <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-teal-50 text-teal-700 dark:bg-teal-950/70 dark:text-teal-300">
                      <NavIcon icon="hosts" className="h-6 w-6" />
                    </div>
                    <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                      No servers yet
                    </h2>
                    <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">
                      Save a host, choose password or private-key
                      authentication, and open a full SSH terminal.
                    </p>
                    <Button
                      type="button"
                      onClick={() => openModal({ kind: "host" })}
                      className="mt-4"
                    >
                      Add server
                    </Button>
                  </div>
                ) : hostsGridQuery && !hosts.some(hostMatchesGridSearch) ? (
                  <div className="rounded-xl border border-slate-200 bg-white px-5 py-9 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
                    <h2 className="font-bold text-slate-900 dark:text-slate-100">
                      No matching servers
                    </h2>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      Try a different name, address, username, or tag.
                    </p>
                    <button
                      type="button"
                      onClick={() => setHostsGridSearch("")}
                      className="mt-4 text-sm font-semibold text-teal-600 hover:text-teal-700 dark:text-teal-400"
                    >
                      Clear search
                    </button>
                  </div>
                ) : (
                  renderGroupSection(null)
                )}

                {gridDeleteError && (
                  <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
                    {gridDeleteError}
                  </p>
                )}
                {gridContextMenu}
                {gridContextMenuConfirmDialog}
              </div>
            )}
            {mainView.type === "manage" && mainView.tab === "identities" && (
              <IdentitiesPanel
                onNew={() => openModal({ kind: "identity" })}
                onEdit={(identity) => openModal({ kind: "identity", identity })}
              />
            )}
            {mainView.type === "manage" && mainView.tab === "keys" && (
              <KeysPanel onNew={() => openModal({ kind: "key" })} />
            )}
            {mainView.type === "manage" && mainView.tab === "vpn" && (
              <VpnPanel
                onNew={() => openModal({ kind: "vpn-profile" })}
                onEdit={(profile) =>
                  openModal({ kind: "vpn-profile", profile })
                }
              />
            )}
            {mainView.type === "manage" && mainView.tab === "workspaces" && (
              <WorkspacesPanel
                hasOpenSessions={openSessions.length > 0}
                onSaveCurrentLayout={handleSaveCurrentLayout}
                onOpen={handleOpenWorkspace}
              />
            )}
            {mainView.type === "manage" && mainView.tab === "backup" && (
              <BackupPanel />
            )}
            {mainView.type === "manage" && mainView.tab === "settings" && (
              <SettingsPanel />
            )}
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
                mainView.type === "session" && mainView.tabId === s.tabId
                  ? "visible"
                  : "invisible"
              }`}
            >
              {s.kind === "terminal" && s.layout ? (
                <PaneSplitView
                  tabId={s.tabId}
                  node={s.layout}
                  totalPaneCount={countLeaves(s.layout)}
                  broadcastEnabled={s.broadcastEnabled}
                  onToggleBroadcast={() => toggleBroadcast(s.tabId)}
                  onSplit={(paneId, direction, host) =>
                    handleSplitPane(s.tabId, paneId, direction, host)
                  }
                  onClosePane={(paneId) => handleClosePane(s.tabId, paneId)}
                />
              ) : (
                <SftpBrowser
                  host={s.host}
                  onClose={() => handleCloseTab(s.tabId)}
                />
              )}
            </div>
          ))}
        </div>
      </main>

      {rightPanelOpen && !rightPanelOverlays && (
        <div>
          <ResizeHandle
            panelSide="right"
            width={rightPanelWidth}
            onResize={setRightPanelWidth}
            onReset={() => setRightPanelWidth(DEFAULT_RIGHT_PANEL_WIDTH)}
            onDragStateChange={setIsDraggingRightPanel}
          />
        </div>
      )}
      <div
        style={{
          width: rightPanelOpen ? rightPanelWidth : 0,
          maxWidth: "calc(100vw - 6.5rem)",
        }}
        aria-hidden={!rightPanelOpen}
        className={`${rightPanelOverlays ? "absolute inset-y-0 right-[52px] z-40 shadow-2xl" : "relative shrink-0"} overflow-hidden border-l border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950 ${
          isDraggingRightPanel ? "" : "transition-[width] duration-150 ease-out"
        }`}
      >
        <div className="h-full w-full">
          {isInlineFormModal(modal) ? (
            <InlineFormPanel
              modal={modal}
              onDone={closeInlineForm}
              onSaved={(kind) => {
                const labels: Record<typeof kind, string> = {
                  group: "Group saved.",
                  host: "Server saved.",
                  identity: "Identity saved.",
                  key: "SSH key saved.",
                  "vpn-profile": "VPN profile saved.",
                };
                notify(labels[kind], "success");
              }}
              onSaveAndConnectHost={(host) => {
                closeInlineForm();
                notify("Server saved. Opening a terminal…", "success");
                handleConnect(host);
              }}
            />
          ) : snippetsDrawerOpen ? (
            <SnippetsDrawer
              onNew={() => setModal({ kind: "snippet" })}
              onEdit={(snippet) => setModal({ kind: "snippet", snippet })}
              onRun={(snippet) => setModal({ kind: "run-snippet", snippet })}
              onClose={handleSnippetsToggle}
            />
          ) : (
            contextHost && (
              <HostContextPanel
                host={contextHost}
                sessionOpen={contextHostSessionOpen}
                vpnBusy={vpnGateHostId === contextHost.id}
                vpnError={
                  vpnGateError?.hostId === contextHost.id
                    ? vpnGateError.message
                    : null
                }
                onConnect={() => handleConnect(contextHost)}
                onOpenSftp={() => handleOpenSftp(contextHost)}
              />
            )
          )}
        </div>
      </div>

      {/* Floats over the terminal rather than sharing the docked slot above -
          see AiAssistantDrawer.tsx for why (doesn't compete with the
          terminal for width, and the user needs to click into the terminal
          while it's open without it closing). */}
      {aiPanelOpen && (
        <AiAssistantDrawer
          host={contextHost}
          onClose={toggleAiPanel}
          onOpenSettings={() =>
            setMainView({ type: "manage", tab: "settings" })
          }
        />
      )}

      <nav className="flex w-[52px] shrink-0 flex-col items-center gap-1 border-l border-slate-200 bg-slate-100/90 py-2 dark:border-slate-800 dark:bg-slate-950">
        <button
          type="button"
          title={rightPanelOpen ? "Hide details" : "Show details"}
          aria-label={rightPanelOpen ? "Hide details" : "Show details"}
          onClick={handleRightPanelToggle}
          className="flex h-8 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-white hover:text-teal-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-teal-300"
        >
          <NavIcon
            icon={sidebarToggleIcon("right", rightPanelOpen)}
            className="h-4 w-4"
          />
        </button>
        <button
          type="button"
          title={snippetsDrawerOpen ? "Hide Snippets" : "Show Snippets"}
          aria-label={snippetsDrawerOpen ? "Hide Snippets" : "Show Snippets"}
          onClick={handleSnippetsToggle}
          className={`flex h-9 w-9 items-center justify-center rounded-lg ${
            snippetsDrawerOpen
              ? "bg-teal-600 text-white shadow-md shadow-slate-950/10"
              : "text-slate-500 hover:bg-white hover:text-teal-600 dark:text-slate-400 dark:hover:bg-slate-800"
          }`}
        >
          <NavIcon icon="snippets" className="h-5 w-5" />
        </button>
        <button
          type="button"
          title={aiPanelOpen ? "Hide AI Assistant" : "Show AI Assistant"}
          aria-label={aiPanelOpen ? "Hide AI Assistant" : "Show AI Assistant"}
          onClick={toggleAiPanel}
          className={`flex h-9 w-9 items-center justify-center rounded-lg ${
            aiPanelOpen
              ? "bg-teal-600 text-white shadow-md shadow-slate-950/10"
              : "text-slate-500 hover:bg-white hover:text-teal-600 dark:text-slate-400 dark:hover:bg-slate-800"
          }`}
        >
          <NavIcon icon="ai" className="h-5 w-5" />
        </button>
      </nav>

      {modal?.kind === "snippet" && (
        <Modal
          title={modal.snippet ? "Edit snippet" : "New snippet"}
          onClose={() => setModal(null)}
        >
          <SnippetForm
            snippet={modal.snippet}
            onDone={() => {
              setModal(null);
              notify("Snippet saved.", "success");
            }}
          />
        </Modal>
      )}
      {modal?.kind === "run-snippet" && (
        <Modal
          title={`Run "${modal.snippet.label}"`}
          onClose={() => setModal(null)}
        >
          <RunSnippetForm
            snippet={modal.snippet}
            onDone={() => {
              setModal(null);
              notify("Snippet completed.", "success");
            }}
          />
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
            {importResult.imported === 0 &&
              importResult.updated === 0 &&
              "No hosts to import."}
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
      {paletteOpen && (
        <CommandPalette
          hosts={hosts}
          actions={paletteActions}
          onConnectHost={handleConnect}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </div>
  );
}
