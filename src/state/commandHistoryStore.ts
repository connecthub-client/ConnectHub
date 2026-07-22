import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface CommandHistoryEntry {
  id: string;
  label: string;
  body: string;
  ranAt: string;
  exitStatus: number | null;
  error: string | null;
}

const MAX_ENTRIES_PER_HOST = 100;

export interface RemoteHistoryRank {
  command: string;
  count: number;
}

interface CommandHistoryState {
  // Keyed by host id - each list capped at the 100 most recent entries,
  // newest first. HostContextPanel's Quick Commands section shows both a
  // "Most used" ranking (see topUsedCommands below) and a short "Recent"
  // tail drawn from this same list.
  byHost: Record<string, CommandHistoryEntry[]>;
  record: (hostId: string, entry: Omit<CommandHistoryEntry, "id" | "ranAt">) => void;
  // Top-10-by-frequency computed from the remote server's own shell history
  // file (see parseRemoteHistory/rankRemoteHistory below), refreshed each
  // time a session connects - see TerminalView.tsx's post-connect fetch.
  // Keyed by host id; a host with no entry here (fetch failed, no history
  // file, non-bash/zsh shell) falls back to topUsedCommands's local ranking
  // in HostContextPanel instead.
  remoteTopUsed: Record<string, RemoteHistoryRank[]>;
  setRemoteTopUsed: (hostId: string, ranked: RemoteHistoryRank[]) => void;
}

export const useCommandHistoryStore = create<CommandHistoryState>()(
  persist(
    (set, get) => ({
      byHost: {},
      remoteTopUsed: {},

      record: (hostId, entry) => {
        const existing = get().byHost[hostId] ?? [];
        const next = [
          { ...entry, id: crypto.randomUUID(), ranAt: new Date().toISOString() },
          ...existing,
        ].slice(0, MAX_ENTRIES_PER_HOST);
        set({ byHost: { ...get().byHost, [hostId]: next } });
      },

      setRemoteTopUsed: (hostId, ranked) => {
        set({ remoteTopUsed: { ...get().remoteTopUsed, [hostId]: ranked } });
      },
    }),
    {
      name: "connecthub-command-history",
      // Bumped when `body` was added to each entry - older persisted
      // entries don't have it, and re-running one without a body would
      // fail, so a version bump just starts history fresh rather than
      // trying to backfill data that was never recorded.
      version: 1,
      migrate: () => ({ byHost: {} }),
    },
  ),
);

// Parses raw `.bash_history`/`.zsh_history` file content into a flat list
// of command strings, stripping the metadata each format can carry: zsh's
// EXTENDED_HISTORY prefix (": <epoch>:<duration>;<command>") and bash's
// HISTTIMEFORMAT companion lines (a bare "#<epoch>" line immediately before
// the command it timestamps).
export function parseRemoteHistory(raw: string): string[] {
  const commands: string[] = [];
  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^#\d+$/.test(line)) continue;
    const zshMatch = line.match(/^:\s*\d+:\d+;(.*)$/);
    commands.push(zshMatch ? zshMatch[1].trim() : line);
  }
  return commands;
}

// Ranks parsed history lines by frequency, most-used first; ties broken by
// which command last appeared closer to the end of the file (most recent).
export function rankRemoteHistory(commands: string[], limit: number): RemoteHistoryRank[] {
  const lastIndex = new Map<string, number>();
  const counts = new Map<string, number>();
  commands.forEach((command, index) => {
    counts.set(command, (counts.get(command) ?? 0) + 1);
    lastIndex.set(command, index);
  });
  return Array.from(counts.entries())
    .map(([command, count]) => ({ command, count }))
    .sort((a, b) => b.count - a.count || lastIndex.get(b.command)! - lastIndex.get(a.command)!)
    .slice(0, limit);
}

export interface CommandUsageRank {
  label: string;
  body: string;
  count: number;
  lastRanAt: string;
}

// Ranks commands by how often they were run within the given history
// (the caller passes a host's full, already-capped-at-100 entry list),
// most-used first; ties broken by most recently run.
export function topUsedCommands(entries: CommandHistoryEntry[], limit: number): CommandUsageRank[] {
  const byLabel = new Map<string, CommandUsageRank>();
  for (const entry of entries) {
    const existing = byLabel.get(entry.label);
    if (existing) {
      existing.count += 1;
      if (entry.ranAt > existing.lastRanAt) {
        existing.lastRanAt = entry.ranAt;
        existing.body = entry.body;
      }
    } else {
      byLabel.set(entry.label, {
        label: entry.label,
        body: entry.body,
        count: 1,
        lastRanAt: entry.ranAt,
      });
    }
  }
  return Array.from(byLabel.values())
    .sort((a, b) => b.count - a.count || (a.lastRanAt < b.lastRanAt ? 1 : -1))
    .slice(0, limit);
}
