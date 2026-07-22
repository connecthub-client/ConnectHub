import { useCallback, useState } from "react";
import Modal from "./Modal";
import { inputClass } from "../forms/formStyles";

interface PromptState {
  message: string;
  resolve: (value: string | null) => void;
}

// Promise-based replacement for the native window.prompt(), which is
// unstyled (breaks out of the app's theme) and can't be awaited the way
// this can: `const name = await prompt(...)`.
export function usePrompt() {
  const [state, setState] = useState<PromptState | null>(null);
  const [value, setValue] = useState("");

  const prompt = useCallback((message: string, defaultValue = "") => {
    return new Promise<string | null>((resolve) => {
      setValue(defaultValue);
      setState({ message, resolve });
    });
  }, []);

  function respond(result: string | null) {
    state?.resolve(result);
    setState(null);
  }

  const promptDialog = state && (
    <Modal title={state.message} onClose={() => respond(null)}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          respond(value);
        }}
      >
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.currentTarget.value)}
          className={inputClass}
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => respond(null)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-lg bg-teal-600 shadow-sm px-3 py-2 text-sm font-medium text-white transition hover:bg-teal-700"
          >
            OK
          </button>
        </div>
      </form>
    </Modal>
  );

  return { prompt, promptDialog };
}
