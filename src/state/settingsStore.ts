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
  { keys: "Ctrl/Cmd + B", action: "Toggle the left sidebar" },
  { keys: "Ctrl/Cmd + Shift + B", action: "Toggle the right panel" },
];

// Drag-resize clamps for the left sidebar and right panel - loose enough to
// be useful (host tree labels/HostContextPanel toggle rows need some
// minimum room) but bounded so a bad persisted value (or a drag past the
// window edge) can't collapse a panel to unusable or blow past the window.
export const MIN_LEFT_SIDEBAR_WIDTH = 180;
export const MAX_LEFT_SIDEBAR_WIDTH = 480;
export const DEFAULT_LEFT_SIDEBAR_WIDTH = 256;
export const MIN_RIGHT_PANEL_WIDTH = 260;
export const MAX_RIGHT_PANEL_WIDTH = 560;
export const DEFAULT_RIGHT_PANEL_WIDTH = 320;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

interface SettingsState {
  theme: ThemeMode;
  terminalFontFamily: string;
  terminalFontSize: number;
  terminalCursorStyle: CursorStyle;
  terminalThemeKey: TerminalThemeKey;
  // Whole-left-region visibility (nav rail + whatever it's showing, e.g. the
  // host tree) and the right-side Snippets drawer - see AppShell.tsx.
  leftSidebarVisible: boolean;
  // Drag-resized width, independent of visibility - collapsing and
  // re-expanding a panel restores whatever width it was last dragged to,
  // since hiding it never touches this value.
  leftSidebarWidth: number;
  snippetsDrawerOpen: boolean;
  // The whole right-hand content slot (HostContextPanel or SnippetsDrawer,
  // whichever is showing) - independent of which one is selected via
  // snippetsDrawerOpen, same collapse-to-a-thin-rail idea as
  // leftSidebarVisible but for the opposite edge.
  rightPanelVisible: boolean;
  rightPanelWidth: number;
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
  setLeftSidebarWidth: (width: number) => void;
  toggleSnippetsDrawer: () => void;
  toggleRightPanel: () => void;
  setRightPanelWidth: (width: number) => void;
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
      leftSidebarWidth: DEFAULT_LEFT_SIDEBAR_WIDTH,
      snippetsDrawerOpen: false,
      rightPanelVisible: true,
      rightPanelWidth: DEFAULT_RIGHT_PANEL_WIDTH,
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
      setLeftSidebarWidth: (width) =>
        set({ leftSidebarWidth: clamp(width, MIN_LEFT_SIDEBAR_WIDTH, MAX_LEFT_SIDEBAR_WIDTH) }),
      toggleSnippetsDrawer: () => set({ snippetsDrawerOpen: !get().snippetsDrawerOpen }),
      toggleRightPanel: () => set({ rightPanelVisible: !get().rightPanelVisible }),
      setRightPanelWidth: (width) =>
        set({ rightPanelWidth: clamp(width, MIN_RIGHT_PANEL_WIDTH, MAX_RIGHT_PANEL_WIDTH) }),
      togglePerformancePanel: () => set({ performancePanelVisible: !get().performancePanelVisible }),
      toggleHostDetails: () => set({ hostDetailsVisible: !get().hostDetailsVisible }),
      toggleQuickCommandAutoRun: () => set({ quickCommandAutoRun: !get().quickCommandAutoRun }),
    }),
    {
      name: "connecthub-settings",
      // Clamp on rehydration too, not just in the setters - a value from
      // localStorage (hand-edited, or saved by a future version with wider
      // bounds) shouldn't be able to leave a panel permanently oversized/
      // undersized until the user happens to drag it again.
      merge: (persisted, current) => {
        const merged = { ...current, ...(persisted as Partial<SettingsState>) };
        merged.leftSidebarWidth = clamp(
          merged.leftSidebarWidth,
          MIN_LEFT_SIDEBAR_WIDTH,
          MAX_LEFT_SIDEBAR_WIDTH,
        );
        merged.rightPanelWidth = clamp(merged.rightPanelWidth, MIN_RIGHT_PANEL_WIDTH, MAX_RIGHT_PANEL_WIDTH);
        return merged;
      },
    },
  ),
);
