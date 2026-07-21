import { useCallback, useState } from "react";
import Modal from "./Modal";

interface ConfirmOptions {
  title?: string;
  // Red "Delete"-style confirm button instead of the default teal "OK" -
  // use for anything destructive/irreversible.
  danger?: boolean;
  confirmLabel?: string;
}

interface ConfirmState extends Required<ConfirmOptions> {
  message: string;
  resolve: (value: boolean) => void;
}

// Promise-based replacement for the native window.confirm(), which breaks
// out of the app's theme entirely (an unstyled OS dialog) and can't be
// awaited from an async handler the way this can: `if (await confirm(...))`.
export function useConfirm() {
  const [state, setState] = useState<ConfirmState | null>(null);

  const confirm = useCallback((message: string, options?: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setState({
        message,
        title: options?.title ?? "Confirm",
        danger: options?.danger ?? false,
        confirmLabel: options?.confirmLabel ?? (options?.danger ? "Delete" : "OK"),
        resolve,
      });
    });
  }, []);

  function respond(value: boolean) {
    state?.resolve(value);
    setState(null);
  }

  const confirmDialog = state && (
    <Modal title={state.title} onClose={() => respond(false)}>
      <p className="mb-4 text-sm text-neutral-700 dark:text-neutral-300">{state.message}</p>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => respond(false)}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          Cancel
        </button>
        <button
          type="button"
          autoFocus
          onClick={() => respond(true)}
          className={
            state.danger
              ? "rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-700"
              : "rounded-md bg-teal-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-teal-700"
          }
        >
          {state.confirmLabel}
        </button>
      </div>
    </Modal>
  );

  return { confirm, confirmDialog };
}
