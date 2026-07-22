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
  dark: { label: "Dark", background: "#020617", foreground: "#e2e8f0", cursor: "#2dd4bf" },
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
  // Whole-left-region visibility (nav rail + whatever it's showing, e.g. the
  // host tree) and the right-side Snippets drawer - see AppShell.tsx.
  leftSidebarVisible: boolean;
  snippetsDrawerOpen: boolean;
  // The whole right-hand content slot (HostContextPanel or SnippetsDrawer,
  // whichever is showing) - independent of which one is selected via
  // snippetsDrawerOpen, same collapse-to-a-thin-rail idea as
  // leftSidebarVisible but for the opposite edge.
  rightPanelVisible: boolean;
  // The Performance section within HostContextPanel.
  performancePanelVisible: boolean;
  // The combined Details+Status section within HostContextPanel - shown
  // regardless of connection state, independently toggleable same as
  // Performance.
  hostDetailsVisible: boolean;
  // Quick Commands' Auto-Run switch: ON sends a command straight into the
  // active terminal session followed by Enter; OFF just types it into the
  // terminal's input line for the user to review/edit/submit themselves.
  quickCommandAutoRun: boolean;
  setTheme: (theme: ThemeMode) => void;
  setTerminalFontFamily: (fontFamily: string) => void;
  setTerminalFontSize: (fontSize: number) => void;
  setTerminalCursorStyle: (cursorStyle: CursorStyle) => void;
  setTerminalThemeKey: (themeKey: TerminalThemeKey) => void;
  toggleLeftSidebar: () => void;
  setLeftSidebarVisible: (visible: boolean) => void;
  toggleSnippetsDrawer: () => void;
  toggleRightPanel: () => void;
  togglePerformancePanel: () => void;
  toggleHostDetails: () => void;
  toggleQuickCommandAutoRun: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      theme: "dark",
      terminalFontFamily: "Menlo, Monaco, 'Courier New', monospace",
      terminalFontSize: 13,
      terminalCursorStyle: "block",
      terminalThemeKey: "dark",
      leftSidebarVisible: true,
      snippetsDrawerOpen: false,
      rightPanelVisible: true,
      performancePanelVisible: true,
      hostDetailsVisible: true,
      quickCommandAutoRun: true,

      setTheme: (theme) => set({ theme }),
      setTerminalFontFamily: (terminalFontFamily) => set({ terminalFontFamily }),
      setTerminalFontSize: (terminalFontSize) => set({ terminalFontSize }),
      setTerminalCursorStyle: (terminalCursorStyle) => set({ terminalCursorStyle }),
      setTerminalThemeKey: (terminalThemeKey) => set({ terminalThemeKey }),
      toggleLeftSidebar: () => set({ leftSidebarVisible: !get().leftSidebarVisible }),
      setLeftSidebarVisible: (leftSidebarVisible) => set({ leftSidebarVisible }),
      toggleSnippetsDrawer: () => set({ snippetsDrawerOpen: !get().snippetsDrawerOpen }),
      toggleRightPanel: () => set({ rightPanelVisible: !get().rightPanelVisible }),
      togglePerformancePanel: () => set({ performancePanelVisible: !get().performancePanelVisible }),
      toggleHostDetails: () => set({ hostDetailsVisible: !get().hostDetailsVisible }),
      toggleQuickCommandAutoRun: () => set({ quickCommandAutoRun: !get().quickCommandAutoRun }),
    }),
    { name: "connecthub-settings" },
  ),
);
