import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { openUrl } from "@tauri-apps/plugin-opener";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import "@xterm/xterm/css/xterm.css";
import { sessionConnect, sessionDisconnect, sessionResize, sessionWrite } from "../../lib/tauri-bridge";
import { Host } from "../../lib/tauri-bridge";
import { TERMINAL_THEME_PRESETS, useSettingsStore } from "../../state/settingsStore";
import { useHostsStore } from "../../state/hostsStore";
import { MAX_PANES, SessionStatus, useSessionsStore } from "../../state/sessionsStore";
import { parseRemoteHistory, rankRemoteHistory, useCommandHistoryStore } from "../../state/commandHistoryStore";
import { useSnippetsStore } from "../../state/snippetsStore";
import { friendlyError } from "../../lib/friendlyError";
import { useTerminalContextMenu } from "./useTerminalContextMenu";

// Reads whichever shell history file exists, most recent lines last, so
// HostContextPanel's "Most used" can be seeded from real usage on the
// server itself rather than only what's been run through ConnectHub - see
// commandHistoryStore.ts's remoteTopUsed. Run as a one-off exec (not the
// interactive PTY), same as Quick Commands/stats polling.
const HISTORY_FETCH_COMMAND =
  'if [ -f "$HOME/.zsh_history" ]; then tail -n 150 "$HOME/.zsh_history"; else tail -n 150 "$HOME/.bash_history" 2>/dev/null; fi';

// Matches a password/passphrase prompt in remote output, so the line the
// user types right after it can be skipped from history instead of saved
// in plaintext - best-effort (there's no real shell integration telling us
// what's actually a secret prompt vs. just text containing the word), but
// a meaningful safeguard against the common case of sudo/su/ssh-key
// passphrase prompts ending up in local command history. Deliberately just
// the bare words rather than requiring an immediately-following colon -
// real prompts vary ("Password:", "[sudo] password for alice:", "Enter
// passphrase for key '...':") and a stricter pattern would miss most of
// them. The cost of a false positive (skipping a normal line that happens
// to mention "password") is far lower than the cost of a false negative
// (a real secret ending up in plaintext local history).
const SECRET_PROMPT_RE = /password|passphrase/i;

// Bounded retry schedule for settingsStore.autoReconnectEnabled - a flaky
// host gets a few chances with increasing delay rather than being hammered
// in a tight loop; once exhausted, the manual "Reconnect" button (always
// shown regardless of the setting) is the fallback. Only "error" events
// (keepalive failure, network drop) trigger this - a "closed" event is left
// alone (no auto-retry) since it's ambiguous whether the user just typed
// `exit`, and silently reconnecting a deliberately-closed shell would be
// surprising.
const RECONNECT_BACKOFF_MS = [2000, 4000, 8000, 16000, 30000];

// Coalesces settingsStore.autoCopyOnSelectEnabled's clipboard write - xterm
// fires onSelectionChange on every character while a mouse-drag is active,
// so writing to the clipboard on every single event would spam the plugin's
// IPC call for no benefit once the drag settles.
const SELECTION_COPY_DEBOUNCE_MS = 150;

async function copySelectionToClipboard(term: Terminal) {
  const text = term.getSelection();
  if (!text) return; // never overwrite the clipboard with an empty selection
  try {
    await writeText(text);
  } catch {
    // best-effort, same as the remote-history fetch below
  }
}

async function pasteFromClipboard(term: Terminal) {
  try {
    const text = await readText();
    // Funneled through xterm's own paste() rather than relying on the
    // native textarea `paste` DOM event, so every paste entry point (this,
    // the context menu, the keyboard shortcuts) shares one mechanism.
    if (text) term.paste(text);
  } catch {
    // clipboard empty/non-text - no-op
  }
  term.focus();
}

interface TerminalViewProps {
  host: Host;
  tabId: string;
  paneId: string;
  paneCount: number;
  broadcastEnabled: boolean;
  onSplit: () => void;
  onToggleBroadcast: () => void;
  // Closes this pane specifically - AppShell.tsx routes this to closing the
  // whole tab instead when it's the tab's only remaining pane, so this
  // button reads the same as "Close" always has for a single-pane tab.
  onClose: () => void;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export default function TerminalView({
  host,
  tabId,
  paneId,
  paneCount,
  broadcastEnabled,
  onSplit,
  onToggleBroadcast,
  onClose,
}: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const sessionIdRef = useRef<string | null>(null);
  // Set inside the connect effect to the effect's own connectSession()
  // closure, so the manual "Reconnect" button (in render scope) can trigger
  // a fresh attempt without needing its own copy of the connect logic.
  const connectSessionRef = useRef<(() => void) | null>(null);
  const [status, setLocalStatus] = useState<SessionStatus>("connecting");
  // Mirrors into sessionsStore so the tab bar (which doesn't render this
  // component's own header) can show live connection status too.
  function setStatus(next: SessionStatus) {
    setLocalStatus(next);
    useSessionsStore.getState().setStatus(paneId, next);
  }
  const [error, setError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const { openContextMenu, menu: terminalContextMenu } = useTerminalContextMenu({
    onCopy: () => {
      const term = termRef.current;
      if (term) void copySelectionToClipboard(term);
    },
    onPaste: () => {
      const term = termRef.current;
      if (term) void pasteFromClipboard(term);
    },
  });

  useEffect(() => {
    if (!containerRef.current) return;

    const initialSettings = useSettingsStore.getState();
    const initialThemePreset = TERMINAL_THEME_PRESETS[initialSettings.terminalThemeKey];

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: initialSettings.terminalFontFamily,
      fontSize: initialSettings.terminalFontSize,
      cursorStyle: initialSettings.terminalCursorStyle,
      theme: initialThemePreset,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    const searchAddon = new SearchAddon();
    term.loadAddon(searchAddon);
    // Default handler uses window.open(), which doesn't behave usefully in
    // a Tauri webview - route through the OS's actual default browser
    // instead.
    term.loadAddon(new WebLinksAddon((_event, uri) => { void openUrl(uri); }));
    // Lets a remote program request clipboard read/write via OSC 52 escape
    // sequences (e.g. tmux/vim "copy to system clipboard") - previously
    // copy/paste only worked via the browser's native text-selection
    // behavior, with no way for a remote program to push to the clipboard
    // itself.
    term.loadAddon(new ClipboardAddon());
    // Ctrl/Cmd+F opens the search bar below instead of falling through to
    // whatever the shell/remote program would otherwise do with it -
    // xterm's own key handler is used (rather than a window-level
    // listener) so this only fires while this specific terminal actually
    // has focus, which matters since multiple session tabs stay mounted
    // at once.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && !e.shiftKey && key === "f") {
        e.preventDefault();
        setSearchOpen(true);
        // Deferred: the search bar only renders after this state update
        // commits, so the input doesn't exist yet on this tick.
        setTimeout(() => searchInputRef.current?.focus(), 0);
        return false;
      }
      // Ctrl/Cmd+C: copy if there's a selection (PuTTY/GNOME Terminal
      // convention) - otherwise fall through untouched so xterm's default
      // handling still sends \x03 (SIGINT) to the remote process. This is
      // the one behavior that must never break: interrupting a running
      // remote command with no selection active.
      if (mod && !e.shiftKey && key === "c") {
        if (term.hasSelection()) {
          e.preventDefault();
          void copySelectionToClipboard(term);
          return false;
        }
        return true;
      }
      // Ctrl/Cmd+Shift+C: explicit copy, a distinct combo that never
      // collides with SIGINT.
      if (mod && e.shiftKey && key === "c") {
        e.preventDefault();
        if (term.hasSelection()) void copySelectionToClipboard(term);
        return false;
      }
      // Ctrl/Cmd+V and Ctrl/Cmd+Shift+V: both paste, funneled through the
      // same term.paste() path as the right-click Paste action rather than
      // xterm's native textarea paste event, so there's one consistent
      // mechanism instead of two subtly different ones.
      if (mod && key === "v") {
        e.preventDefault();
        void pasteFromClipboard(term);
        return false;
      }
      return true;
    });
    term.open(containerRef.current);
    fitAddon.fit();
    termRef.current = term;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;

    let disposed = false;
    let reconnectAttempts = 0;
    let reconnectTimeout: ReturnType<typeof setTimeout> | undefined;
    let selectionCopyTimeout: ReturnType<typeof setTimeout> | undefined;

    const onSelectionChange = term.onSelectionChange(() => {
      clearTimeout(selectionCopyTimeout);
      selectionCopyTimeout = setTimeout(() => {
        if (!useSettingsStore.getState().autoCopyOnSelectEnabled) return;
        // Re-check: the selection may have been cleared (clicked elsewhere)
        // during the debounce window - copySelectionToClipboard's own
        // empty-string guard covers this too, but this avoids even calling
        // it in the common case.
        if (term.hasSelection()) void copySelectionToClipboard(term);
      }, SELECTION_COPY_DEBOUNCE_MS);
    });

    // Best-effort local-echo tracking of what the user types, so
    // HostContextPanel's "Most used"/"Recent" can reflect real terminal
    // usage rather than only clicks on saved Snippets - see
    // commandHistoryStore.ts. Not real shell integration (no OSC 133
    // semantic prompts), so this is a heuristic: it re-derives "lines" from
    // raw keystrokes sent to the remote rather than anything the remote
    // shell itself reports.
    let lineBuffer = "";
    let outputTail = "";
    let suppressNextLine = false;

    // Schedules an automatic retry if the setting is on and attempts
    // remain, otherwise settles into the given terminal status - shared by
    // both the "error" event branch and the initial-connect failure path,
    // since both represent "not connected, tab still open."
    function handleDisconnect(settledStatus: "closed" | "error") {
      if (disposed) return;
      sessionIdRef.current = null;
      if (
        settledStatus === "error" &&
        useSettingsStore.getState().autoReconnectEnabled &&
        reconnectAttempts < RECONNECT_BACKOFF_MS.length
      ) {
        const delay = RECONNECT_BACKOFF_MS[reconnectAttempts];
        reconnectAttempts += 1;
        setStatus("reconnecting");
        reconnectTimeout = setTimeout(() => connectSession(), delay);
      } else {
        setStatus(settledStatus);
      }
    }

    function connectSession() {
      if (disposed) return;
      clearTimeout(reconnectTimeout);
      setError(null);
      setStatus(reconnectAttempts > 0 ? "reconnecting" : "connecting");
      sessionConnect(host.id, (event) => {
        if (disposed) return;
        if (event.type === "data") {
          const bytes = base64ToBytes(event.data);
          term.write(bytes);
          outputTail = (outputTail + new TextDecoder().decode(bytes)).slice(-256);
          if (SECRET_PROMPT_RE.test(outputTail)) {
            suppressNextLine = true;
            // Otherwise the matched text just sits in the tail (nothing
            // else has pushed it out of the last 256 characters yet) and
            // keeps re-matching on every subsequent chunk, effectively
            // suppressing history forever instead of for one line.
            outputTail = "";
          }
        } else if (event.type === "closed") {
          handleDisconnect("closed");
        } else if (event.type === "error") {
          setError(event.message);
          handleDisconnect("error");
        }
      })
        .then((sessionId) => {
          if (disposed) {
            sessionDisconnect(sessionId);
            return;
          }
          sessionIdRef.current = sessionId;
          reconnectAttempts = 0;
          setStatus("connected");
          sessionResize(sessionId, term.cols, term.rows);
          useHostsStore.getState().loadAll();
          useSessionsStore.getState().setSessionId(paneId, sessionId);

          // Best-effort - a restricted account, a shell with no history
          // file, or a server that doesn't allow this one-off exec just
          // means HostContextPanel falls back to its own locally-recorded
          // ranking.
          useSnippetsStore
            .getState()
            .runOnHosts([host.id], HISTORY_FETCH_COMMAND)
            .then(([result]) => {
              if (disposed || !result?.output?.stdout) return;
              const commands = parseRemoteHistory(result.output.stdout);
              if (commands.length === 0) return;
              useCommandHistoryStore.getState().setRemoteTopUsed(host.id, rankRemoteHistory(commands, 10));
            })
            .catch(() => {});
        })
        .catch((e) => {
          setError(friendlyError(e));
          handleDisconnect("error");
        });
    }

    // Lets the manual "Reconnect" button (render scope, outside this
    // effect) trigger a fresh attempt - resets the backoff counter, since a
    // deliberate click shouldn't be throttled by however far the automatic
    // schedule had already progressed.
    connectSessionRef.current = () => {
      reconnectAttempts = 0;
      connectSession();
    };

    connectSession();

    const onData = term.onData((data) => {
      if (sessionIdRef.current) {
        sessionWrite(sessionIdRef.current, data);
      }

      // Broadcast fan-out: read the tab's current pane list/flag fresh from
      // the store on every keystroke rather than closing over a snapshot -
      // this effect only re-runs on host.id changing, but broadcastEnabled
      // and sibling panes can change any time while it's connected (the
      // toggle, or splitting/closing a pane).
      const tabSession = useSessionsStore.getState().openSessions.find((s) => s.tabId === tabId);
      if (tabSession?.broadcastEnabled) {
        for (const pane of tabSession.panes) {
          if (pane.paneId === paneId) continue;
          const siblingSessionId = useSessionsStore.getState().sessionIds[pane.paneId];
          if (siblingSessionId) sessionWrite(siblingSessionId, data);
        }
      }

      // Skip escape sequences whole (arrow keys, function keys, bracketed
      // paste markers, etc.) rather than feeding their bytes into the line
      // buffer as if they were typed text.
      if (data.startsWith("\x1b")) return;

      for (const ch of data) {
        const code = ch.charCodeAt(0);
        if (ch === "\r" || ch === "\n") {
          const line = lineBuffer.trim();
          lineBuffer = "";
          if (line && !suppressNextLine) {
            useCommandHistoryStore.getState().record(host.id, {
              label: line,
              body: line,
              exitStatus: null,
              error: null,
            });
          }
          suppressNextLine = false;
        } else if (ch === "\x7f" || ch === "\b") {
          lineBuffer = lineBuffer.slice(0, -1);
        } else if (ch === "\x03" || ch === "\x15") {
          // Ctrl+C / Ctrl+U - the in-progress line was aborted or cleared,
          // not submitted, so drop it rather than recording a fragment.
          lineBuffer = "";
        } else if (code >= 32) {
          lineBuffer += ch;
        }
      }
    });

    const resizeObserver = new ResizeObserver((entries) => {
      // When this tab is hidden (display:none), its box collapses to 0x0 -
      // fitting to that would reflow the buffer down to 0 rows/cols and
      // drop scrollback. Skip until it's actually visible again.
      const { width, height } = entries[0].contentRect;
      if (width === 0 || height === 0) return;

      fitAddon.fit();
      if (sessionIdRef.current) {
        sessionResize(sessionIdRef.current, term.cols, term.rows);
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      disposed = true;
      clearTimeout(reconnectTimeout);
      clearTimeout(selectionCopyTimeout);
      resizeObserver.disconnect();
      onData.dispose();
      onSelectionChange.dispose();
      if (sessionIdRef.current) {
        sessionDisconnect(sessionIdRef.current);
      }
      term.dispose();
    };
  }, [host.id]);

  const terminalFontFamily = useSettingsStore((s) => s.terminalFontFamily);
  const terminalFontSize = useSettingsStore((s) => s.terminalFontSize);
  const terminalCursorStyle = useSettingsStore((s) => s.terminalCursorStyle);
  const terminalThemeKey = useSettingsStore((s) => s.terminalThemeKey);
  const themePreset = TERMINAL_THEME_PRESETS[terminalThemeKey];

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    term.options.fontFamily = terminalFontFamily;
    term.options.fontSize = terminalFontSize;
    term.options.cursorStyle = terminalCursorStyle;
    term.options.theme = themePreset;

    fitAddonRef.current?.fit();
    if (sessionIdRef.current) {
      sessionResize(sessionIdRef.current, term.cols, term.rows);
    }
  }, [terminalFontFamily, terminalFontSize, terminalCursorStyle, themePreset]);

  function closeSearch() {
    setSearchOpen(false);
    searchAddonRef.current?.clearDecorations();
    termRef.current?.focus();
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-100 px-4 py-2 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2 text-sm">
          <span
            className={`h-2 w-2 rounded-full ${
              status === "connected"
                ? "bg-emerald-500"
                : status === "connecting"
                  ? "bg-amber-500"
                  : status === "reconnecting"
                    ? "bg-amber-500 animate-pulse"
                    : "bg-red-500"
            }`}
          />
          <span className="font-medium text-slate-900 dark:text-slate-100">{host.label}</span>
          <span className="text-slate-400">
            {host.hostname}:{host.port}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {(paneCount > 1 || broadcastEnabled) && (
            <button
              type="button"
              onClick={onToggleBroadcast}
              title={
                broadcastEnabled
                  ? "Broadcast is on: typing here also sends to every other pane in this tab"
                  : "Broadcast is off: typing here only affects this pane"
              }
              className={`rounded-lg px-2 py-1 text-xs font-medium ${
                broadcastEnabled
                  ? "bg-teal-600 text-white"
                  : "text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800"
              }`}
            >
              Broadcast
            </button>
          )}
          <button
            type="button"
            onClick={onSplit}
            disabled={paneCount >= MAX_PANES}
            title={
              paneCount >= MAX_PANES
                ? `Up to ${MAX_PANES} panes per tab`
                : "Split: open another pane to this same host"
            }
            className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-200 disabled:opacity-40 disabled:hover:bg-transparent dark:hover:bg-slate-800"
          >
            Split
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800"
          >
            Close
          </button>
        </div>
      </div>

      {(status === "error" || status === "closed") && (
        <div className="flex items-center justify-between gap-3 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          <span>{error ?? "Session closed."}</span>
          <button
            type="button"
            onClick={() => connectSessionRef.current?.()}
            className="shrink-0 rounded-lg border border-red-300 px-2 py-1 text-xs font-medium hover:bg-red-100 dark:border-red-800 dark:hover:bg-red-900"
          >
            Reconnect
          </button>
        </div>
      )}

      {searchOpen && (
        <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5 dark:border-slate-800 dark:bg-slate-950">
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.currentTarget.value);
              searchAddonRef.current?.findNext(e.currentTarget.value, { incremental: true });
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                closeSearch();
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (e.shiftKey) {
                  searchAddonRef.current?.findPrevious(searchQuery);
                } else {
                  searchAddonRef.current?.findNext(searchQuery);
                }
              }
            }}
            placeholder="Search scrollback…"
            className="flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 outline-none focus:border-teal-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
          <button
            type="button"
            onClick={() => searchAddonRef.current?.findPrevious(searchQuery)}
            title="Previous match (Shift+Enter)"
            className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => searchAddonRef.current?.findNext(searchQuery)}
            title="Next match (Enter)"
            className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={closeSearch}
            aria-label="Close search"
            className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800"
          >
            ✕
          </button>
        </div>
      )}

      <div className="relative min-h-0 flex-1 p-2" style={{ backgroundColor: themePreset.background }}>
        <div
          ref={containerRef}
          className="h-full w-full"
          onContextMenu={(e) => openContextMenu(e, termRef.current?.hasSelection() ?? false)}
        />
        {terminalContextMenu}
        {(status === "connecting" || status === "reconnecting") && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-3"
            style={{ backgroundColor: themePreset.background }}
          >
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-500 border-t-teal-400" />
            <p className="text-sm" style={{ color: themePreset.foreground }}>
              {status === "reconnecting" ? "Reconnecting to " : "Connecting to "}
              <span className="font-medium">{host.label}</span> ({host.hostname}:
              {host.port})…
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-slate-200 bg-slate-100 px-4 py-1 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
        <span>
          {status === "connected" && `Connected to ${host.label}`}
          {status === "connecting" && "Connecting…"}
          {status === "reconnecting" && "Reconnecting…"}
          {status === "closed" && "Session closed"}
          {status === "error" && "Connection error"}
        </span>
        <span className="capitalize">{status}</span>
      </div>
    </div>
  );
}
