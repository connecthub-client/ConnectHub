import { create } from "zustand";
import { Host } from "../lib/tauri-bridge";

export type SessionKind = "terminal" | "sftp";

export interface OpenSession {
  tabId: string;
  kind: SessionKind;
  host: Host;
}

interface SessionsState {
  openSessions: OpenSession[];
  openSession: (host: Host, kind: SessionKind) => string;
  closeSession: (tabId: string) => void;
  reorderSessions: (fromIndex: number, toIndex: number) => void;
}

export const useSessionsStore = create<SessionsState>((set, get) => ({
  openSessions: [],

  openSession: (host, kind) => {
    const tabId = crypto.randomUUID();
    set((s) => ({
      openSessions: [...s.openSessions, { tabId, kind, host }],
    }));
    return tabId;
  },

  closeSession: (tabId) => {
    set({ openSessions: get().openSessions.filter((s) => s.tabId !== tabId) });
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
