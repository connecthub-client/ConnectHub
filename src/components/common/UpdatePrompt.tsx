import { useEffect, useState } from "react";
import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  appPackageUpdateInstall,
  AppUpdateMethod,
  appUpdateMethod,
} from "../../lib/tauri-bridge";
import { friendlyUpdaterError, RELEASES_URL } from "../../lib/updater";
import Modal from "./Modal";

type PromptState =
  | { phase: "available"; update: Update; method: AppUpdateMethod }
  | { phase: "downloading"; update: Update; percent: number | null }
  | { phase: "error"; update: Update; message: string };

const STARTUP_CHECK_DELAY_MS = 1500;

export default function UpdatePrompt() {
  const [state, setState] = useState<PromptState | null>(null);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const update = await check({ timeout: 15_000 });
        if (!update) return;
        const method = await appUpdateMethod().catch((): AppUpdateMethod => "native");
        if (active) setState({ phase: "available", update, method });
        else void update.close();
      } catch {
        // Startup checks are intentionally quiet when offline. The manual
        // check in Settings remains available and shows a useful error.
      }
    }, STARTUP_CHECK_DELAY_MS);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, []);

  if (!state) return null;

  const dismiss = () => {
    void state.update.close();
    setState(null);
  };

  const install = async () => {
    if (state.phase !== "available") return;
    if (state.method === "unsupported") {
      await openUrl(RELEASES_URL);
      dismiss();
      return;
    }

    const update = state.update;
    let total: number | null = null;
    let downloaded = 0;
    setState({ phase: "downloading", update, percent: null });
    try {
      if (state.method === "native") {
        await update.downloadAndInstall((event) => {
          if (event.event === "Started") {
            total = event.data.contentLength ?? null;
            downloaded = 0;
          } else if (event.event === "Progress") {
            downloaded += event.data.chunkLength;
            setState({
              phase: "downloading",
              update,
              percent: total ? Math.min(100, Math.round((downloaded / total) * 100)) : null,
            });
          }
        });
      } else {
        await appPackageUpdateInstall(update.version);
      }
      await relaunch();
    } catch (error) {
      setState({ phase: "error", update, message: friendlyUpdaterError(error) });
    }
  };

  return (
    <Modal
      title={state.phase === "error" ? "Update couldn't be installed" : "Update available"}
      onClose={dismiss}
      dismissible={state.phase !== "downloading"}
    >
      {state.phase === "available" && (
        <>
          <div className="rounded-2xl bg-indigo-50 p-4 dark:bg-indigo-950/60">
            <p className="text-sm font-bold text-indigo-900 dark:text-indigo-100">
              ConnectHub {state.update.version} is ready
            </p>
            <p className="mt-1 text-xs text-indigo-700 dark:text-indigo-300">
              You are currently using version {state.update.currentVersion}.
            </p>
          </div>
          {state.update.body && (
            <p className="mt-4 max-h-40 overflow-y-auto whitespace-pre-wrap text-sm leading-6 text-slate-600 dark:text-slate-300">
              {state.update.body}
            </p>
          )}
          {(state.method === "deb" || state.method === "rpm") && (
            <p className="mt-4 text-xs leading-5 text-slate-500 dark:text-slate-400">
              ConnectHub will verify the signed {state.method.toUpperCase()} package, then ask for
              administrator authorization to install it.
            </p>
          )}
          {state.method === "unsupported" && (
            <p className="mt-4 text-xs leading-5 text-slate-500 dark:text-slate-400">
              This installation type cannot be updated automatically. Continue to the releases page.
            </p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={dismiss} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
              Later
            </button>
            <button type="button" onClick={() => void install()} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm shadow-indigo-600/20 hover:bg-indigo-700">
              {state.method === "unsupported" ? "Open releases page" : "Update and restart"}
            </button>
          </div>
        </>
      )}

      {state.phase === "downloading" && (
        <div>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Downloading, verifying, and installing ConnectHub {state.update.version}
            {state.percent !== null ? ` — ${state.percent}%` : "…"}
          </p>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
            <div className="h-full rounded-full bg-indigo-600 transition-all" style={{ width: `${state.percent ?? 8}%` }} />
          </div>
          <p className="mt-3 text-xs text-slate-400">
            Package installs may show a system password prompt. ConnectHub will restart when finished.
          </p>
        </div>
      )}

      {state.phase === "error" && (
        <>
          <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">{state.message}</p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={dismiss} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">Close</button>
            <button type="button" onClick={() => void openUrl(RELEASES_URL)} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-700">Open releases page</button>
          </div>
        </>
      )}
    </Modal>
  );
}
