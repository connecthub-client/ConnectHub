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
import { friendlyError } from "../../lib/friendlyError";

interface TerminalViewProps {
  host: Host;
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

export default function TerminalView({ host, onClose }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [status, setStatus] = useState<"connecting" | "connected" | "closed" | "error">(
    "connecting",
  );
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

    sessionConnect(host.id, (event) => {
      if (event.type === "data") {
        term.write(base64ToBytes(event.data));
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
      })
      .catch((e) => {
        setStatus("error");
        setError(friendlyError(e));
      });

    const onData = term.onData((data) => {
      if (sessionIdRef.current) {
        sessionWrite(sessionIdRef.current, data);
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
      <div className="flex items-center justify-between border-b border-neutral-200 bg-neutral-100 px-4 py-2 dark:border-neutral-800 dark:bg-neutral-900">
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
          <span className="font-medium text-neutral-900 dark:text-neutral-100">{host.label}</span>
          <span className="text-neutral-400">
            {host.hostname}:{host.port}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800"
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
        <div className="flex items-center gap-2 border-b border-neutral-200 bg-neutral-50 px-3 py-1.5 dark:border-neutral-800 dark:bg-neutral-950">
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
            className="flex-1 rounded border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900 outline-none focus:border-teal-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          />
          <button
            type="button"
            onClick={() => searchAddonRef.current?.findPrevious(searchQuery)}
            title="Previous match (Shift+Enter)"
            className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => searchAddonRef.current?.findNext(searchQuery)}
            title="Next match (Enter)"
            className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={closeSearch}
            aria-label="Close search"
            className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800"
          >
            ✕
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 p-2" style={{ backgroundColor: themePreset.background }}>
        <div ref={containerRef} className="h-full w-full" />
      </div>

      <div className="flex items-center justify-between border-t border-neutral-200 bg-neutral-100 px-4 py-1 text-xs text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
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
