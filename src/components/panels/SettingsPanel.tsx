import { useEffect, useState } from "react";
import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { appVersion } from "../../lib/tauri-bridge";
import {
  CursorStyle,
  KEYBINDINGS,
  TERMINAL_THEME_PRESETS,
  TerminalThemeKey,
  ThemeMode,
  useSettingsStore,
} from "../../state/settingsStore";
import { inputClass, labelClass, primaryButtonClass, selectClass } from "../forms/formStyles";

const THEME_MODES: ThemeMode[] = ["system", "light", "dark"];
const CURSOR_STYLES: CursorStyle[] = ["block", "bar", "underline"];

// "up-to-date" and "found" are both terminal outcomes of a check; "found"
// additionally carries the Update resource needed to actually install it.
type UpdateState =
  | { phase: "idle" | "checking" | "up-to-date" }
  | { phase: "found"; update: Update }
  | { phase: "downloading"; update: Update; percent: number | null }
  | { phase: "ready-to-restart" }
  | { phase: "error"; message: string };

function AboutSection() {
  const [version, setVersion] = useState<string | null>(null);
  const [state, setState] = useState<UpdateState>({ phase: "idle" });

  // Best-effort - if this fails on mount (a transient IPC hiccup), leave
  // the placeholder rather than routing it into the shared update-check
  // error state (conflating "couldn't read the version" with "update
  // check failed" under one message would be confusing), and retry it
  // opportunistically whenever the user clicks "Check for updates" - the
  // one retry affordance already on screen.
  function loadVersion() {
    appVersion()
      .then(setVersion)
      .catch(() => {});
  }

  useEffect(loadVersion, []);

  async function handleCheckForUpdate() {
    if (version === null) loadVersion();
    setState({ phase: "checking" });
    try {
      const update = await check();
      setState(update ? { phase: "found", update } : { phase: "up-to-date" });
    } catch (e) {
      setState({ phase: "error", message: String(e) });
    }
  }

  async function handleInstall(update: Update) {
    let total: number | null = null;
    let downloaded = 0;
    setState({ phase: "downloading", update, percent: null });
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? null;
          downloaded = 0;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setState({
            phase: "downloading",
            update,
            percent: total ? Math.min(100, Math.round((downloaded / total) * 100)) : null,
          });
        }
      });
      setState({ phase: "ready-to-restart" });
    } catch (e) {
      setState({ phase: "error", message: String(e) });
    }
  }

  async function handleRestart() {
    try {
      await relaunch();
    } catch (e) {
      setState({ phase: "error", message: String(e) });
    }
  }

  return (
    <section className="mb-6">
      <h3 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-200">About</h3>
      <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
        ConnectHub {version ? <span className="font-medium">v{version}</span> : "…"}
      </p>

      {(state.phase === "idle" ||
        state.phase === "checking" ||
        state.phase === "up-to-date" ||
        state.phase === "error") && (
        <button
          type="button"
          onClick={handleCheckForUpdate}
          disabled={state.phase === "checking"}
          className={`${primaryButtonClass} disabled:opacity-50`}
        >
          {state.phase === "checking" ? "Checking…" : "Check for updates"}
        </button>
      )}
      {state.phase === "up-to-date" && (
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
          You're on the latest version.
        </p>
      )}

      {state.phase === "found" && (
        <div className="rounded-lg border border-teal-300 bg-teal-50 p-3 text-sm dark:border-teal-800 dark:bg-teal-950">
          <p className="mb-1 font-medium text-teal-800 dark:text-teal-200">
            Version {state.update.version} is available (you have {state.update.currentVersion}).
          </p>
          {state.update.body && (
            <p className="mb-2 whitespace-pre-wrap text-xs text-teal-700 dark:text-teal-300">
              {state.update.body}
            </p>
          )}
          <button
            type="button"
            onClick={() => void handleInstall(state.update)}
            className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-teal-700"
          >
            Download and install
          </button>
        </div>
      )}

      {state.phase === "downloading" && (
        <div className="rounded-lg border border-teal-300 bg-teal-50 p-3 text-sm dark:border-teal-800 dark:bg-teal-950">
          <p className="mb-2 text-teal-800 dark:text-teal-200">
            Downloading version {state.update.version}
            {state.percent !== null ? ` (${state.percent}%)` : "…"}
          </p>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-teal-200 dark:bg-teal-900">
            <div
              className="h-full rounded-full bg-teal-600 transition-all"
              style={{ width: `${state.percent ?? 0}%` }}
            />
          </div>
        </div>
      )}

      {state.phase === "ready-to-restart" && (
        <div className="rounded-lg border border-teal-300 bg-teal-50 p-3 text-sm dark:border-teal-800 dark:bg-teal-950">
          <p className="mb-2 text-teal-800 dark:text-teal-200">
            Update installed — restart to finish updating.
          </p>
          <button
            type="button"
            onClick={() => void handleRestart()}
            className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-teal-700"
          >
            Restart now
          </button>
        </div>
      )}

      {state.phase === "error" && (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400">{state.message}</p>
      )}
    </section>
  );
}

export default function SettingsPanel() {
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const terminalFontFamily = useSettingsStore((s) => s.terminalFontFamily);
  const setTerminalFontFamily = useSettingsStore((s) => s.setTerminalFontFamily);
  const terminalFontSize = useSettingsStore((s) => s.terminalFontSize);
  const setTerminalFontSize = useSettingsStore((s) => s.setTerminalFontSize);
  const terminalCursorStyle = useSettingsStore((s) => s.terminalCursorStyle);
  const setTerminalCursorStyle = useSettingsStore((s) => s.setTerminalCursorStyle);
  const terminalThemeKey = useSettingsStore((s) => s.terminalThemeKey);
  const setTerminalThemeKey = useSettingsStore((s) => s.setTerminalThemeKey);

  return (
    <div className="max-w-xl">
      <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-50">Settings</h2>

      <section className="mb-6">
        <h3 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-200">Appearance</h3>
        <label className={labelClass}>Theme</label>
        <select
          value={theme}
          onChange={(e) => setTheme(e.target.value as ThemeMode)}
          className={selectClass}
        >
          {THEME_MODES.map((t) => (
            <option key={t} value={t}>
              {t === "system" ? "Match system" : t === "light" ? "Light" : "Dark"}
            </option>
          ))}
        </select>
      </section>

      <section className="mb-6">
        <h3 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-200">Terminal</h3>

        <label className={labelClass}>Font family</label>
        <input
          value={terminalFontFamily}
          onChange={(e) => setTerminalFontFamily(e.target.value)}
          className={`${inputClass} font-mono`}
        />

        <label className={labelClass}>Font size ({terminalFontSize}px)</label>
        <input
          type="range"
          min={10}
          max={24}
          value={terminalFontSize}
          onChange={(e) => setTerminalFontSize(Number(e.target.value))}
          className="mb-4 w-full accent-teal-600"
        />

        <label className={labelClass}>Cursor style</label>
        <select
          value={terminalCursorStyle}
          onChange={(e) => setTerminalCursorStyle(e.target.value as CursorStyle)}
          className={selectClass}
        >
          {CURSOR_STYLES.map((c) => (
            <option key={c} value={c}>
              {c[0].toUpperCase() + c.slice(1)}
            </option>
          ))}
        </select>

        <label className={labelClass}>Color theme</label>
        <select
          value={terminalThemeKey}
          onChange={(e) => setTerminalThemeKey(e.target.value as TerminalThemeKey)}
          className={selectClass}
        >
          {(Object.keys(TERMINAL_THEME_PRESETS) as TerminalThemeKey[]).map((key) => (
            <option key={key} value={key}>
              {TERMINAL_THEME_PRESETS[key].label}
            </option>
          ))}
        </select>
      </section>

      <section className="mb-6">
        <h3 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-200">Keybindings</h3>
        <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          {KEYBINDINGS.map((k) => (
            <div key={k.keys} className="flex items-center justify-between px-3 py-2 text-sm">
              <span className="text-slate-600 dark:text-slate-300">{k.action}</span>
              <kbd className="rounded border border-slate-300 bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                {k.keys}
              </kbd>
            </div>
          ))}
        </div>
      </section>

      <AboutSection />
    </div>
  );
}
