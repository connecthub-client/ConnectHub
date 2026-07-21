import { useEffect, useState } from "react";
import {
  GoogleAuthStatus,
  googleBackupNow,
  googleLogin,
  googleLoginCancel,
  googleLogout,
  googleRestore,
  googleStatus,
} from "../../lib/tauri-bridge";
import { primaryButtonClass } from "../forms/formStyles";
import { useConfirm } from "../common/useConfirm";

type ActionState = "idle" | "signing-in" | "backing-up" | "restoring" | "signing-out";

export default function GoogleBackupSection() {
  const [status, setStatus] = useState<GoogleAuthStatus | null>(null);
  const [action, setAction] = useState<ActionState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  useEffect(() => {
    googleStatus()
      .then(setStatus)
      .catch((e) => setError(String(e)));
  }, []);

  async function handleSignIn() {
    setError(null);
    setMessage(null);
    setAction("signing-in");
    try {
      const next = await googleLogin();
      setStatus(next);
    } catch (e) {
      setError(String(e));
    } finally {
      setAction("idle");
    }
  }

  // If the user closed the browser tab without finishing, there's no way
  // for the app to detect that on its own - this lets them bail out
  // immediately instead of waiting out the backend's timeout. The pending
  // googleLogin() call above settles (rejected) once this resolves, which
  // is what actually resets `action` back to "idle".
  async function handleCancelSignIn() {
    try {
      await googleLoginCancel();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleSignOut() {
    setError(null);
    setMessage(null);
    setAction("signing-out");
    try {
      await googleLogout();
      setStatus({ connected: false, email: null });
    } catch (e) {
      setError(String(e));
    } finally {
      setAction("idle");
    }
  }

  async function handleBackup() {
    setError(null);
    setMessage(null);
    setAction("backing-up");
    try {
      await googleBackupNow();
      setMessage("Backed up to Google Drive.");
    } catch (e) {
      setError(String(e));
    } finally {
      setAction("idle");
    }
  }

  async function handleRestore() {
    const confirmed = await confirm(
      "Restore from Google Drive? This replaces every host, identity, key, and snippet on this device with the backed-up copy. This cannot be undone.",
      { danger: true, confirmLabel: "Restore" },
    );
    if (!confirmed) {
      return;
    }
    setError(null);
    setMessage(null);
    setAction("restoring");
    try {
      await googleRestore();
      setMessage("Restored - reloading…");
      setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      setError(String(e));
      setAction("idle");
    }
  }

  if (!status) {
    return <p className="text-sm text-neutral-400">Loading…</p>;
  }

  return (
    <div>
      {!status.connected ? (
        <>
          <p className="mb-3 text-sm text-neutral-500 dark:text-neutral-400">
            Sign in with your own Google account to back up your hosts, identities, keys, and
            snippets to Google Drive, and restore them on another device.
          </p>
          {action === "signing-in" ? (
            <div className="flex gap-2">
              <button
                type="button"
                disabled
                className={`${primaryButtonClass} flex-1 cursor-not-allowed opacity-60`}
              >
                Waiting for sign-in in your browser…
              </button>
              <button
                type="button"
                onClick={handleCancelSignIn}
                className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleSignIn}
              disabled={action !== "idle"}
              className={primaryButtonClass}
            >
              Sign in with Google
            </button>
          )}
        </>
      ) : (
        <>
          <p className="mb-3 text-sm text-neutral-700 dark:text-neutral-300">
            Connected as <span className="font-medium">{status.email ?? "your Google account"}</span>
          </p>
          <div className="mb-3 flex gap-2">
            <button
              type="button"
              onClick={handleBackup}
              disabled={action !== "idle"}
              className="flex-1 rounded-md bg-teal-600 px-3 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
            >
              {action === "backing-up" ? "Backing up…" : "Back up now"}
            </button>
            <button
              type="button"
              onClick={handleRestore}
              disabled={action !== "idle"}
              className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              {action === "restoring" ? "Restoring…" : "Restore from Drive"}
            </button>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={action !== "idle"}
            className="text-xs text-neutral-400 hover:text-red-600 disabled:opacity-50"
          >
            {action === "signing-out" ? "Signing out…" : "Sign out"}
          </button>
        </>
      )}

      {message && (
        <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">{message}</p>
      )}
      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {confirmDialog}
    </div>
  );
}
