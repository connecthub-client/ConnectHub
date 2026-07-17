import { useEffect, useState } from "react";
import AppShell from "./pages/AppShell";
import { vaultAutoUnlock } from "./lib/tauri-bridge";
import { useSettingsStore } from "./state/settingsStore";
import "./App.css";

function useThemeEffect() {
  const theme = useSettingsStore((s) => s.theme);

  useEffect(() => {
    const root = document.documentElement;

    // Also set `color-scheme` explicitly so native form controls (select,
    // scrollbars) follow this override instead of falling back to the OS
    // preference, which `color-scheme: light dark` in App.css otherwise defers to.
    if (theme === "light") {
      root.classList.remove("dark");
      root.style.colorScheme = "light";
      return;
    }
    if (theme === "dark") {
      root.classList.add("dark");
      root.style.colorScheme = "dark";
      return;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      root.classList.toggle("dark", media.matches);
      root.style.colorScheme = media.matches ? "dark" : "light";
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
}

type BootState = "loading" | "ready" | "error";

function App() {
  const [boot, setBoot] = useState<BootState>("loading");
  const [error, setError] = useState<string | null>(null);

  useThemeEffect();

  useEffect(() => {
    (async () => {
      try {
        await vaultAutoUnlock();
        setBoot("ready");
      } catch (e) {
        setBoot("error");
        setError(String(e));
      }
    })();
  }, []);

  if (boot === "loading") {
    return (
      <div className="flex h-full items-center justify-center bg-neutral-100 dark:bg-neutral-900">
        <p className="text-neutral-500 dark:text-neutral-400">Loading…</p>
      </div>
    );
  }

  if (boot === "error") {
    return (
      <div className="flex h-full items-center justify-center bg-neutral-100 dark:bg-neutral-900">
        <p className="text-red-600 dark:text-red-400">{error}</p>
      </div>
    );
  }

  return <AppShell />;
}

export default App;
