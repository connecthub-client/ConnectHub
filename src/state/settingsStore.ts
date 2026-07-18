import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeMode = "light" | "dark" | "system";
export type CursorStyle = "block" | "bar" | "underline";

export interface TerminalThemeColors {
  background: string;
  foreground: string;
  cursor: string;
}

export const TERMINAL_THEME_PRESETS = {
  dark: { label: "Dark", background: "#111827", foreground: "#e5e7eb", cursor: "#e5e7eb" },
  light: { label: "Light", background: "#ffffff", foreground: "#111827", cursor: "#111827" },
  solarizedDark: { label: "Solarized Dark", background: "#002b36", foreground: "#839496", cursor: "#839496" },
  solarizedLight: { label: "Solarized Light", background: "#fdf6e3", foreground: "#657b83", cursor: "#657b83" },
} as const satisfies Record<string, TerminalThemeColors & { label: string }>;

export type TerminalThemeKey = keyof typeof TERMINAL_THEME_PRESETS;

export const KEYBINDINGS: { keys: string; action: string }[] = [
  { keys: "Ctrl/Cmd + W", action: "Close the active session tab" },
  { keys: "Ctrl/Cmd + Tab", action: "Switch to the next session tab" },
  { keys: "Ctrl/Cmd + Shift + Tab", action: "Switch to the previous session tab" },
];

interface SettingsState {
  theme: ThemeMode;
  terminalFontFamily: string;
  terminalFontSize: number;
  terminalCursorStyle: CursorStyle;
  terminalThemeKey: TerminalThemeKey;
  setTheme: (theme: ThemeMode) => void;
  setTerminalFontFamily: (fontFamily: string) => void;
  setTerminalFontSize: (fontSize: number) => void;
  setTerminalCursorStyle: (cursorStyle: CursorStyle) => void;
  setTerminalThemeKey: (themeKey: TerminalThemeKey) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: "dark",
      terminalFontFamily: "Menlo, Monaco, 'Courier New', monospace",
      terminalFontSize: 13,
      terminalCursorStyle: "block",
      terminalThemeKey: "dark",

      setTheme: (theme) => set({ theme }),
      setTerminalFontFamily: (terminalFontFamily) => set({ terminalFontFamily }),
      setTerminalFontSize: (terminalFontSize) => set({ terminalFontSize }),
      setTerminalCursorStyle: (terminalCursorStyle) => set({ terminalCursorStyle }),
      setTerminalThemeKey: (terminalThemeKey) => set({ terminalThemeKey }),
    }),
    { name: "connecthub-settings" },
  ),
);
