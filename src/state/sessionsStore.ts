import { create } from "zustand";
import { Host } from "../lib/tauri-bridge";

export type SessionKind = "terminal" | "sftp";

// One live terminal connection within a tab - a tab normally has exactly
// one, but a terminal tab can be split into up to MAX_PANES, each an
// independent SSH connection to the tab's host (see AppShell.tsx's
// handleAddPane) rather than a multiplexed channel on a shared connection -
// simplest way to add this without touching the backend's connect_and_authenticate,
// which already documents that every session gets its own connection.
export interface Pane {
  paneId: string;
  host: Host;
}

export interface OpenSession {
  tabId: string;
  kind: SessionKind;
  host: Host;
  // Only meaningful for kind === "terminal" (always >= 1 entry then) - SFTP
  // tabs don't support splitting.
  panes: Pane[];
  // Tab-level, off by default: when on, typing in any one pane's terminal
  // fans the input out to every sibling pane in the same tab too. See
  // TerminalView.tsx's onData handler.
  broadcastEnabled: boolean;
}

export const MAX_PANES = 4;

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
  // Adds a new pane (same host as the tab) up to MAX_PANES; returns the new
  // pane's id, or null if the tab is missing, not a terminal, or already at
  // the limit.
  addPane: (tabId: string) => string | null;
  // Removes one pane. Refuses to remove a tab's last remaining pane -
  // closing the whole tab (which tears every pane down) is the tab's own
  // ✕ button instead; AppShell.tsx's handleClosePane routes there itself
  // when only one pane is left, so this only ever needs to handle the
  // "still others left" case.
  closePane: (tabId: string, paneId: string) => void;
  toggleBroadcast: (tabId: string) => void;
}

export const useSessionsStore = create<SessionsState>((set) => ({
  openSessions: [],
  statuses: {},
  sessionIds: {},

  openSession: (host, kind) => {
    const tabId = crypto.randomUUID();
    const panes: Pane[] = kind === "terminal" ? [{ paneId: crypto.randomUUID(), host }] : [];
    set((s) => ({
      openSessions: [...s.openSessions, { tabId, kind, host, panes, broadcastEnabled: false }],
    }));
    return tabId;
  },

  closeSession: (tabId) => {
    set((s) => {
      const closing = s.openSessions.find((session) => session.tabId === tabId);
      const statuses = { ...s.statuses };
      const sessionIds = { ...s.sessionIds };
      (closing?.panes ?? []).forEach((pane) => {
        delete statuses[pane.paneId];
        delete sessionIds[pane.paneId];
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

  addPane: (tabId) => {
    let newPaneId: string | null = null;
    set((s) => ({
      openSessions: s.openSessions.map((session) => {
        if (session.tabId !== tabId || session.kind !== "terminal") return session;
        if (session.panes.length >= MAX_PANES) return session;
        newPaneId = crypto.randomUUID();
        return { ...session, panes: [...session.panes, { paneId: newPaneId, host: session.host }] };
      }),
    }));
    return newPaneId;
  },

  closePane: (tabId, paneId) => {
    set((s) => {
      let removed = false;
      const openSessions = s.openSessions.map((session) => {
        if (session.tabId !== tabId || session.panes.length <= 1) return session;
        if (!session.panes.some((p) => p.paneId === paneId)) return session;
        removed = true;
        return { ...session, panes: session.panes.filter((p) => p.paneId !== paneId) };
      });
      if (!removed) return s;
      const statuses = { ...s.statuses };
      const sessionIds = { ...s.sessionIds };
      delete statuses[paneId];
      delete sessionIds[paneId];
      return { openSessions, statuses, sessionIds };
    });
  },

  toggleBroadcast: (tabId) => {
    set((s) => ({
      openSessions: s.openSessions.map((session) =>
        session.tabId === tabId ? { ...session, broadcastEnabled: !session.broadcastEnabled } : session,
      ),
    }));
  },

  reorderSessions: (fromIndex, toIndex) => {
    set((s) => {
      if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= s.openSessions.length) return s;
      const next = [...s.openSessions];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return { openSessions: next };
    });
  },
}));
