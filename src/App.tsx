import { useEffect, useState } from "react";
import AppShell from "./pages/AppShell";
import VaultLockOverlay from "./components/common/VaultLockOverlay";
import { useIdleTimer } from "./components/common/useIdleTimer";
import { vaultAutoUnlock, vaultLock } from "./lib/tauri-bridge";
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
  const [locked, setLocked] = useState(false);
  const vaultAutoLockEnabled = useSettingsStore((s) => s.vaultAutoLockEnabled);
  const vaultAutoLockMinutes = useSettingsStore((s) => s.vaultAutoLockMinutes);

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

  useIdleTimer(boot === "ready" && vaultAutoLockEnabled && !locked, vaultAutoLockMinutes * 60_000, () => {
    setLocked(true);
    // Best-effort: the lock overlay already blocks all interaction
    // regardless, but clearing the in-memory key too means any
    // secret-decrypting command genuinely fails while locked, not just
    // visually.
    vaultLock().catch(() => {});
  });

  if (boot === "loading") {
    return (
      <div className="flex h-full items-center justify-center bg-slate-100 dark:bg-slate-900">
        <p className="text-slate-500 dark:text-slate-400">Loading…</p>
      </div>
    );
  }

  if (boot === "error") {
    return (
      <div className="flex h-full items-center justify-center bg-slate-100 dark:bg-slate-900">
        <p className="text-red-600 dark:text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <>
      <AppShell />
      {locked && <VaultLockOverlay onUnlocked={() => setLocked(false)} />}
    </>
  );
}

export default App;
