import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { openUrl } from "@tauri-apps/plugin-opener";
import "@xterm/xterm/css/xterm.css";
import { sessionConnect, sessionDisconnect, sessionResize, sessionWrite } from "../../lib/tauri-bridge";
import { Host } from "../../lib/tauri-bridge";
import { TERMINAL_THEME_PRESETS, useSettingsStore } from "../../state/settingsStore";
import { useHostsStore } from "../../state/hostsStore";
import { useSessionsStore } from "../../state/sessionsStore";
import { parseRemoteHistory, rankRemoteHistory, useCommandHistoryStore } from "../../state/commandHistoryStore";
import { useSnippetsStore } from "../../state/snippetsStore";
import { friendlyError } from "../../lib/friendlyError";

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

interface TerminalViewProps {
  host: Host;
  tabId: string;
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

export default function TerminalView({ host, tabId, onClose }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [status, setLocalStatus] = useState<"connecting" | "connected" | "closed" | "error">(
    "connecting",
  );
  // Mirrors into sessionsStore so the tab bar (which doesn't render this
  // component's own header) can show live connection status too.
  function setStatus(next: "connecting" | "connected" | "closed" | "error") {
    setLocalStatus(next);
    useSessionsStore.getState().setStatus(tabId, next);
  }
  const [error, setError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

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
      if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearchOpen(true);
        // Deferred: the search bar only renders after this state update
        // commits, so the input doesn't exist yet on this tick.
        setTimeout(() => searchInputRef.current?.focus(), 0);
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

    setStatus("connecting");
    sessionConnect(host.id, (event) => {
      if (event.type === "data") {
        const bytes = base64ToBytes(event.data);
        term.write(bytes);
        outputTail = (outputTail + new TextDecoder().decode(bytes)).slice(-256);
        if (SECRET_PROMPT_RE.test(outputTail)) {
          suppressNextLine = true;
          // Otherwise the matched text just sits in the tail (nothing else
          // has pushed it out of the last 256 characters yet) and keeps
          // re-matching on every subsequent chunk, effectively suppressing
          // history forever instead of for one line.
          outputTail = "";
        }
      } else if (event.type === "closed") {
        setStatus("closed");
      } else if (event.type === "error") {
        setStatus("error");
        setError(event.message);
      }
    })
      .then((sessionId) => {
        if (disposed) {
          sessionDisconnect(sessionId);
          return;
        }
        sessionIdRef.current = sessionId;
        setStatus("connected");
        sessionResize(sessionId, term.cols, term.rows);
        useHostsStore.getState().loadAll();
        useSessionsStore.getState().setSessionId(tabId, sessionId);

        // Best-effort - a restricted account, a shell with no history file,
        // or a server that doesn't allow this one-off exec just means
        // HostContextPanel falls back to its own locally-recorded ranking.
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
        setStatus("error");
        setError(friendlyError(e));
      });

    const onData = term.onData((data) => {
      if (sessionIdRef.current) {
        sessionWrite(sessionIdRef.current, data);
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
      resizeObserver.disconnect();
      onData.dispose();
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
                  : "bg-red-500"
            }`}
          />
          <span className="font-medium text-slate-900 dark:text-slate-100">{host.label}</span>
          <span className="text-slate-400">
            {host.hostname}:{host.port}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800"
        >
          Close
        </button>
      </div>

      {error && (
        <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          {error}
        </p>
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
        <div ref={containerRef} className="h-full w-full" />
        {status === "connecting" && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-3"
            style={{ backgroundColor: themePreset.background }}
          >
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-500 border-t-teal-400" />
            <p className="text-sm" style={{ color: themePreset.foreground }}>
              Connecting to <span className="font-medium">{host.label}</span> ({host.hostname}:
              {host.port})…
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-slate-200 bg-slate-100 px-4 py-1 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
        <span>
          {status === "connected" && `Connected to ${host.label}`}
          {status === "connecting" && "Connecting…"}
          {status === "closed" && "Session closed"}
          {status === "error" && "Connection error"}
        </span>
        <span className="capitalize">{status}</span>
      </div>
    </div>
  );
}
