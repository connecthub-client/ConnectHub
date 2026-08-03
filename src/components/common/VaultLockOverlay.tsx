import { useState } from "react";
import { vaultAutoUnlock } from "../../lib/tauri-bridge";

interface VaultLockOverlayProps {
  onUnlocked: () => void;
}

// Shown after vaultAutoLockMinutes of inactivity (App.tsx). There's no
// master password to prompt for here - "Unlock" just re-runs the same
// vaultAutoUnlock call the app already does on launch, re-deriving the
// per-installation secret. The friction is the deliberate click itself,
// not a secret only the user knows - see settingsStore.ts's comment on
// vaultAutoLockEnabled for why that's still meaningfully more friction
// than the always-unlocked default.
export default function VaultLockOverlay({ onUnlocked }: VaultLockOverlayProps) {
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUnlock() {
    setUnlocking(true);
    setError(null);
    try {
      await vaultAutoUnlock();
      onUnlocked();
    } catch (e) {
      setError(String(e));
    } finally {
      setUnlocking(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 bg-slate-950/95 backdrop-blur-sm">
      <p className="text-lg font-medium text-slate-100">ConnectHub is locked</p>
      <p className="max-w-sm text-center text-sm text-slate-400">
        Locked after a period of inactivity. Click below to resume.
      </p>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="button"
        onClick={handleUnlock}
        disabled={unlocking}
        className="rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-teal-700 disabled:opacity-50"
      >
        {unlocking ? "Unlocking…" : "Unlock"}
      </button>
    </div>
  );
}
