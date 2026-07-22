import { create } from "zustand";
import { Host } from "../lib/tauri-bridge";

export type SessionKind = "terminal" | "sftp";

export interface OpenSession {
  tabId: string;
  kind: SessionKind;
  host: Host;
}

// A terminal tab's live connection status, mirrored here rather than kept
// only as local state inside TerminalView - same reasoning as vpnStore's
// `statuses` map: the tab bar needs to show it without the terminal
// component itself needing to be mounted/rendered to report it.
export type SessionStatus = "connecting" | "connected" | "closed" | "error";

interface SessionsState {
  openSessions: OpenSession[];
  statuses: Record<string, SessionStatus>;
  // The backend session id for each *terminal* tab (session/sftp bridge
  // calls need this, not the tabId) - published once TerminalView's
  // sessionConnect resolves, so other components (HostContextPanel's Quick
  // Commands) can write into a specific host's live PTY without owning the
  // connection themselves.
  sessionIds: Record<string, string>;
  openSession: (host: Host, kind: SessionKind) => string;
  closeSession: (tabId: string) => void;
  reorderSessions: (fromIndex: number, toIndex: number) => void;
  setStatus: (tabId: string, status: SessionStatus) => void;
  setSessionId: (tabId: string, sessionId: string) => void;
}

export const useSessionsStore = create<SessionsState>((set) => ({
  openSessions: [],
  statuses: {},
  sessionIds: {},

  openSession: (host, kind) => {
    const tabId = crypto.randomUUID();
    set((s) => ({
      openSessions: [...s.openSessions, { tabId, kind, host }],
    }));
    return tabId;
  },

  closeSession: (tabId) => {
    set((s) => {
      const statuses = { ...s.statuses };
      delete statuses[tabId];
      const sessionIds = { ...s.sessionIds };
      delete sessionIds[tabId];
      return {
        openSessions: s.openSessions.filter((session) => session.tabId !== tabId),
        statuses,
        sessionIds,
      };
    });
  },

  setStatus: (tabId, status) => {
    set((s) => ({ statuses: { ...s.statuses, [tabId]: status } }));
  },

  setSessionId: (tabId, sessionId) => {
    set((s) => ({ sessionIds: { ...s.sessionIds, [tabId]: sessionId } }));
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
