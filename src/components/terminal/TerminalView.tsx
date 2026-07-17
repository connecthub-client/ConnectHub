import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { sessionConnect, sessionDisconnect, sessionResize, sessionWrite } from "../../lib/tauri-bridge";
import { Host } from "../../lib/tauri-bridge";
import { TERMINAL_THEME_PRESETS, useSettingsStore } from "../../state/settingsStore";
import { useHostsStore } from "../../state/hostsStore";

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
  const sessionIdRef = useRef<string | null>(null);
  const [status, setStatus] = useState<"connecting" | "connected" | "closed" | "error">(
    "connecting",
  );
  const [error, setError] = useState<string | null>(null);

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
    term.open(containerRef.current);
    fitAddon.fit();
    termRef.current = term;
    fitAddonRef.current = fitAddon;

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
        setError(String(e));
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
