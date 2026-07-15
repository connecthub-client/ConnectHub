import { useEffect, useRef, useState } from "react";
import VaultUnlock from "./pages/VaultUnlock";
import AppShell from "./pages/AppShell";
import { vaultLock } from "./lib/tauri-bridge";
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

function useAutoLock(unlocked: boolean, onLock: () => void) {
  const autoLockMinutes = useSettingsStore((s) => s.autoLockMinutes);
  const lastActivityRef = useRef(Date.now());

  useEffect(() => {
    if (!unlocked || autoLockMinutes <= 0) return;

    // Reset here (not just on activity) - while locked, no activity events are
    // tracked, so the ref can be arbitrarily stale by the time the vault is
    // unlocked again. Without this, the first idle check after unlocking
    // sees that stale timestamp and re-locks almost immediately.
    lastActivityRef.current = Date.now();

    const markActivity = () => {
      lastActivityRef.current = Date.now();
    };
    const events = ["mousemove", "mousedown", "keydown", "wheel", "touchstart"] as const;
    events.forEach((evt) => window.addEventListener(evt, markActivity));

    const interval = window.setInterval(() => {
      const idleMs = Date.now() - lastActivityRef.current;
      if (idleMs >= autoLockMinutes * 60_000) {
        vaultLock()
          .catch(() => undefined)
          .finally(onLock);
      }
    }, 5_000);

    return () => {
      events.forEach((evt) => window.removeEventListener(evt, markActivity));
      window.clearInterval(interval);
    };
  }, [unlocked, autoLockMinutes, onLock]);
}

function App() {
  const [unlocked, setUnlocked] = useState(false);

  useThemeEffect();
  useAutoLock(unlocked, () => setUnlocked(false));

  if (!unlocked) {
    return <VaultUnlock onUnlocked={() => setUnlocked(true)} />;
  }

  return <AppShell />;
}

export default App;
