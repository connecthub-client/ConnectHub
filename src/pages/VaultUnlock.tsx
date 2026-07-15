import { FormEvent, useEffect, useState } from "react";
import { vaultCreate, vaultStatus, vaultUnlock } from "../lib/tauri-bridge";

interface VaultUnlockProps {
  onUnlocked: () => void;
}

export default function VaultUnlock({ onUnlocked }: VaultUnlockProps) {
  const [checking, setChecking] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    vaultStatus()
      .then((status) => setInitialized(status.initialized))
      .catch((e) => setError(String(e)))
      .finally(() => setChecking(false));
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!initialized && password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (!initialized && password.length < 8) {
      setError("Master password must be at least 8 characters");
      return;
    }

    setSubmitting(true);
    try {
      if (initialized) {
        await vaultUnlock(password);
      } else {
        await vaultCreate(password);
      }
      onUnlocked();
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  }

  if (checking) {
    return (
      <div className="flex h-full items-center justify-center bg-neutral-100 dark:bg-neutral-900">
        <p className="text-neutral-500 dark:text-neutral-400">Loading…</p>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center bg-neutral-100 dark:bg-neutral-900">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-8 shadow-sm dark:border-neutral-800 dark:bg-neutral-950"
      >
        <h1 className="mb-1 text-xl font-semibold text-neutral-900 dark:text-neutral-50">
          {initialized ? "Unlock your vault" : "Create your vault"}
        </h1>
        <p className="mb-6 text-sm text-neutral-500 dark:text-neutral-400">
          {initialized
            ? "Enter your master password to unlock saved hosts and keys."
            : "Choose a master password. It encrypts everything stored locally and cannot be recovered if lost."}
        </p>

        <label className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
          Master password
        </label>
        <input
          type="password"
          autoFocus
          autoComplete={initialized ? "current-password" : "new-password"}
          value={password}
          onChange={(e) => setPassword(e.currentTarget.value)}
          className="mb-4 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-blue-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          required
        />

        {!initialized && (
          <>
            <label className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Confirm password
            </label>
            <input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.currentTarget.value)}
              className="mb-4 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-blue-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              required
            />
          </>
        )}

        {error && (
          <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting
            ? "Please wait…"
            : initialized
              ? "Unlock"
              : "Create vault"}
        </button>
      </form>
    </div>
  );
}
