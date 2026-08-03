import { FormEvent, useState } from "react";
import { Snippet } from "../../lib/tauri-bridge";
import { useSnippetsStore } from "../../state/snippetsStore";
import { FieldErrors } from "../../lib/formValidation";
import { errorClass, inputClass, labelClass, primaryButtonClass } from "./formStyles";
import FieldError from "./FieldError";
import RequiredMark from "./RequiredMark";

interface SnippetFormProps {
  snippet?: Snippet;
  onDone: () => void;
}

export default function SnippetForm({ snippet, onDone }: SnippetFormProps) {
  const createSnippet = useSnippetsStore((s) => s.createSnippet);
  const updateSnippet = useSnippetsStore((s) => s.updateSnippet);

  const [label, setLabel] = useState(snippet?.label ?? "");
  const [body, setBody] = useState(snippet?.body ?? "");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const errors: FieldErrors = {};
    if (!label.trim()) errors.label = "Enter a label.";
    if (!body.trim()) errors.body = "Enter a command.";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setSubmitting(true);
    try {
      const input = { label, body };
      if (snippet) {
        await updateSnippet(snippet.id, input);
      } else {
        await createSnippet(input);
      }
      onDone();
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <label className={labelClass}>
        Label
        <RequiredMark />
      </label>
      <input
        autoFocus
        value={label}
        onChange={(e) => setLabel(e.currentTarget.value)}
        className={inputClass}
        placeholder="e.g. disk usage"
        required
      />
      <FieldError message={fieldErrors.label} />

      <label className={labelClass}>
        Command
        <RequiredMark />
      </label>
      <textarea
        value={body}
        onChange={(e) => setBody(e.currentTarget.value)}
        className={`${inputClass} h-28 font-mono text-xs`}
        placeholder="df -h"
        required
      />
      <FieldError message={fieldErrors.body} />

      {error && <p className={errorClass}>{error}</p>}

      <button type="submit" disabled={submitting} className={primaryButtonClass}>
        {submitting ? "Saving…" : snippet ? "Save changes" : "Create snippet"}
      </button>
    </form>
  );
}
