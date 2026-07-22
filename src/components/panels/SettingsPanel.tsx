import {
  CursorStyle,
  KEYBINDINGS,
  TERMINAL_THEME_PRESETS,
  TerminalThemeKey,
  ThemeMode,
  useSettingsStore,
} from "../../state/settingsStore";
import { inputClass, labelClass, selectClass } from "../forms/formStyles";

const THEME_MODES: ThemeMode[] = ["system", "light", "dark"];
const CURSOR_STYLES: CursorStyle[] = ["block", "bar", "underline"];

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

      <section>
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
    </div>
  );
}
