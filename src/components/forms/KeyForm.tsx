import { FormEvent, useState } from "react";
import { useHostsStore } from "../../state/hostsStore";
import { errorClass, inputClass, labelClass, primaryButtonClass } from "./formStyles";

interface KeyFormProps {
  onDone: () => void;
}

export default function KeyForm({ onDone }: KeyFormProps) {
  const generateKey = useHostsStore((s) => s.generateKey);
  const importKey = useHostsStore((s) => s.importKey);

  const [mode, setMode] = useState<"generate" | "import">("generate");
  const [label, setLabel] = useState("");
  const [privateKeyPem, setPrivateKeyPem] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "generate") {
        await generateKey({ label });
      } else {
        await importKey({
          label,
          private_key_pem: privateKeyPem,
          passphrase: passphrase || null,
        });
      }
      onDone();
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="mb-4 flex rounded-md border border-neutral-300 p-1 text-sm dark:border-neutral-700">
        <button
          type="button"
          onClick={() => setMode("generate")}
          className={`flex-1 rounded px-3 py-1.5 ${mode === "generate" ? "bg-blue-600 text-white" : "text-neutral-600 dark:text-neutral-300"}`}
        >
          Generate new
        </button>
        <button
          type="button"
          onClick={() => setMode("import")}
          className={`flex-1 rounded px-3 py-1.5 ${mode === "import" ? "bg-blue-600 text-white" : "text-neutral-600 dark:text-neutral-300"}`}
        >
          Import existing
        </button>
      </div>

      <label className={labelClass}>Label</label>
      <input
        autoFocus
        value={label}
        onChange={(e) => setLabel(e.currentTarget.value)}
        className={inputClass}
        placeholder="e.g. laptop key"
        required
      />

      {mode === "generate" ? (
        <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
          Generates a new Ed25519 keypair. The private key is encrypted and stored in your vault.
        </p>
      ) : (
        <>
          <label className={labelClass}>Private key (OpenSSH format)</label>
          <textarea
            value={privateKeyPem}
            onChange={(e) => setPrivateKeyPem(e.currentTarget.value)}
            className={`${inputClass} h-32 font-mono text-xs`}
            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
            required
          />

          <label className={labelClass}>Passphrase (if the key is encrypted)</label>
          <input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.currentTarget.value)}
            className={inputClass}
            autoComplete="new-password"
          />
        </>
      )}

      {error && <p className={errorClass}>{error}</p>}

      <button type="submit" disabled={submitting} className={primaryButtonClass}>
        {submitting ? "Saving…" : mode === "generate" ? "Generate key" : "Import key"}
      </button>
    </form>
  );
}
