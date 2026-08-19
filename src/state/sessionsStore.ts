import { create } from "zustand";
import { Host } from "../lib/tauri-bridge";
import { collectLeaves, countLeaves, findLeaf, PaneNode, removeLeaf, resizeSplit, splitLeaf } from "../lib/paneTree";

export type SessionKind = "terminal" | "sftp";

export interface OpenSession {
  tabId: string;
  kind: SessionKind;
  host: Host;
  // Only meaningful for kind === "terminal" - SFTP tabs don't support
  // splitting, so their layout is always null. A terminal tab's layout is
  // a binary split tree (see lib/paneTree.ts): one leaf per independent
  // SSH connection, each an independent connection to the tab's host by
  // default but any leaf can point at a different host (see
  // AppShell.tsx's handleSplitPane) rather than a multiplexed channel on a
  // shared connection - simplest way to add this without touching the
  // backend's connect_and_authenticate, which already documents that
  // every session gets its own connection.
  layout: PaneNode | null;
  // Tab-level, off by default: when on, typing in any one pane's terminal
  // fans the input out to every sibling pane in the same tab too. See
  // TerminalView.tsx's onData handler.
  broadcastEnabled: boolean;
}

// Each pane is a full independent SSH connection + its own xterm.js
// Terminal instance (FitAddon/SearchAddon/WebLinksAddon/ClipboardAddon/
// ResizeObserver) - a real, compounding resource cost, especially since
// multiple tabs can also be open simultaneously and stay mounted. 9 is the
// practical ceiling before panes become too small to be useful on a
// typical laptop screen regardless of raw resource cost.
export const MAX_PANES = 9;

// A terminal tab's live connection status, mirrored here rather than kept
// only as local state inside TerminalView - same reasoning as vpnStore's
// `statuses` map: the tab bar needs to show it without the terminal
// component itself needing to be mounted/rendered to report it.
// "reconnecting" is a distinct in-between state from "connecting" - it
// means TerminalView.tsx is retrying an existing tab's dropped connection
// (settingsStore.autoReconnectEnabled), not opening a brand-new session.
export type SessionStatus = "connecting" | "connected" | "closed" | "error" | "reconnecting";

interface SessionsState {
  openSessions: OpenSession[];
  // Both keyed by paneId (not tabId) - a terminal tab can have several live
  // panes, each its own backend session/status. SFTP tabs (no panes) don't
  // use either map.
  statuses: Record<string, SessionStatus>;
  sessionIds: Record<string, string>;
  openSession: (host: Host, kind: SessionKind) => string;
  closeSession: (tabId: string) => void;
  reorderSessions: (fromIndex: number, toIndex: number) => void;
  setStatus: (paneId: string, status: SessionStatus) => void;
  setSessionId: (paneId: string, sessionId: string) => void;
  // Splits the pane identified by `paneId` into two - the original pane
  // keeps its own host, the new one connects to `host` (defaulting to the
  // same host being split, if omitted). Returns the new pane's id, or null
  // if the tab/pane wasn't found or the tab is already at MAX_PANES.
  splitPane: (tabId: string, paneId: string, direction: "row" | "column", host?: Host) => string | null;
  // Removes one pane, collapsing its parent split so the sibling takes over
  // that space. Refuses to remove a tab's last remaining pane - closing
  // the whole tab (which tears every pane down) is the tab's own ✕ button
  // instead; AppShell.tsx's handleClosePane routes there itself when only
  // one pane is left, so this only ever needs to handle the "still others
  // left" case.
  closePane: (tabId: string, paneId: string) => void;
  resizePaneSplit: (tabId: string, splitId: string, ratio: number) => void;
  // Replaces a tab's whole layout in one shot - used only when restoring a
  // saved Workspace's exact split shape, where every leaf's VPN gating has
  // already been handled by the caller (AppShell.tsx::handleOpenWorkspace)
  // before this is called, unlike splitPane's own per-call gating.
  setLayout: (tabId: string, layout: PaneNode) => void;
  toggleBroadcast: (tabId: string) => void;
}

// The host's live terminal session's backend id, if one is open and
// connected - the tab's primary (first) pane, same target Quick Commands
// writes into (HostContextPanel.tsx) and the AI Assistant's runCommand
// (aiStore.ts) run a proposed command in. A plain function (not a hook) so
// it works both reactively, called with selector results inside a component,
// and imperatively, called with `useSessionsStore.getState()` inside a
// store action.
export function findLiveSessionId(
  openSessions: OpenSession[],
  sessionIds: Record<string, string>,
  hostId: string,
): string | undefined {
  const terminalTab = openSessions.find((s) => s.host.id === hostId && s.kind === "terminal");
  const firstPaneId = terminalTab?.layout ? collectLeaves(terminalTab.layout)[0]?.paneId : undefined;
  return firstPaneId ? sessionIds[firstPaneId] : undefined;
}

export const useSessionsStore = create<SessionsState>((set) => ({
  openSessions: [],
  statuses: {},
  sessionIds: {},

  openSession: (host, kind) => {
    const tabId = crypto.randomUUID();
    const layout: PaneNode | null = kind === "terminal" ? { type: "leaf", paneId: crypto.randomUUID(), host } : null;
    set((s) => ({
      openSessions: [...s.openSessions, { tabId, kind, host, layout, broadcastEnabled: false }],
    }));
    return tabId;
  },

  closeSession: (tabId) => {
    set((s) => {
      const closing = s.openSessions.find((session) => session.tabId === tabId);
      const statuses = { ...s.statuses };
      const sessionIds = { ...s.sessionIds };
      const leaves = closing?.layout ? collectLeaves(closing.layout) : [];
      leaves.forEach((leaf) => {
        delete statuses[leaf.paneId];
        delete sessionIds[leaf.paneId];
      });
      return {
        openSessions: s.openSessions.filter((session) => session.tabId !== tabId),
        statuses,
        sessionIds,
      };
    });
  },

  setStatus: (paneId, status) => {
    set((s) => ({ statuses: { ...s.statuses, [paneId]: status } }));
  },

  setSessionId: (paneId, sessionId) => {
    set((s) => ({ sessionIds: { ...s.sessionIds, [paneId]: sessionId } }));
  },

  splitPane: (tabId, paneId, direction, host) => {
    const newPaneId = crypto.randomUUID();
    let created = false;
    set((s) => ({
      openSessions: s.openSessions.map((session) => {
        if (session.tabId !== tabId || session.kind !== "terminal" || !session.layout) return session;
        if (countLeaves(session.layout) >= MAX_PANES) return session;
        const leaf = findLeaf(session.layout, paneId);
        if (!leaf) return session;
        created = true;
        return { ...session, layout: splitLeaf(session.layout, paneId, direction, newPaneId, host ?? leaf.host) };
      }),
    }));
    return created ? newPaneId : null;
  },

  closePane: (tabId, paneId) => {
    set((s) => {
      let removed = false;
      const openSessions = s.openSessions.map((session) => {
        if (session.tabId !== tabId || session.kind !== "terminal" || !session.layout) return session;
        if (session.layout.type === "leaf" || !findLeaf(session.layout, paneId)) return session;
        const next = removeLeaf(session.layout, paneId);
        if (next === null) return session; // shouldn't happen given the single-pane guard above, but never collapse to nothing here
        removed = true;
        return { ...session, layout: next };
      });
      if (!removed) return s;
      const statuses = { ...s.statuses };
      const sessionIds = { ...s.sessionIds };
      delete statuses[paneId];
      delete sessionIds[paneId];
      return { openSessions, statuses, sessionIds };
    });
  },

  setLayout: (tabId, layout) => {
    set((s) => ({
      openSessions: s.openSessions.map((session) => (session.tabId === tabId ? { ...session, layout } : session)),
    }));
  },

  resizePaneSplit: (tabId, splitId, ratio) => {
    set((s) => ({
      openSessions: s.openSessions.map((session) =>
        session.tabId === tabId && session.layout
          ? { ...session, layout: resizeSplit(session.layout, splitId, ratio) }
          : session,
      ),
    }));
  },

  toggleBroadcast: (tabId) => {
    set((s) => ({
      openSessions: s.openSessions.map((session) =>
        session.tabId === tabId ? { ...session, broadcastEnabled: !session.broadcastEnabled } : session,
      ),
    }));
  },

  // toIndex means "insert before whatever sat at this index in the
  // *original* array" (openSessions.length means "insert at the very
  // end") - a forward move needs toIndex decremented by one, since
  // removing fromIndex already shifted every later index left by one.
  reorderSessions: (fromIndex, toIndex) => {
    set((s) => {
      if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        fromIndex >= s.openSessions.length ||
        toIndex < 0 ||
        toIndex > s.openSessions.length
      )
        return s;
      const next = [...s.openSessions];
      const [moved] = next.splice(fromIndex, 1);
      const insertAt = fromIndex < toIndex ? toIndex - 1 : toIndex;
      next.splice(Math.max(0, Math.min(insertAt, next.length)), 0, moved);
      return { openSessions: next };
    });
  },
}));
