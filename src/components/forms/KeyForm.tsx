import { FormEvent, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { localReadTextFile } from "../../lib/tauri-bridge";
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

  async function handleBrowse() {
    setError(null);
    try {
      const path = await open({
        multiple: false,
        title: "Select a private key file",
      });
      if (!path || Array.isArray(path)) return;
      const contents = await localReadTextFile(path);
      setPrivateKeyPem(contents);
      if (!label) {
        const fileName = path.split(/[/\\]/).pop() ?? "";
        setLabel(fileName.replace(/\.(pem|key|pub)$/i, ""));
      }
    } catch (err) {
      setError(String(err));
    }
  }

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
          className={`flex-1 rounded px-3 py-1.5 ${mode === "generate" ? "bg-teal-600 text-white" : "text-neutral-600 dark:text-neutral-300"}`}
        >
          Generate new
        </button>
        <button
          type="button"
          onClick={() => setMode("import")}
          className={`flex-1 rounded px-3 py-1.5 ${mode === "import" ? "bg-teal-600 text-white" : "text-neutral-600 dark:text-neutral-300"}`}
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
          <div className="mb-1 flex items-center justify-between">
            <label className={labelClass}>Private key (OpenSSH or PEM format)</label>
            <button
              type="button"
              onClick={handleBrowse}
              className="mb-1 text-xs font-medium text-teal-600 hover:text-teal-700 dark:text-teal-400"
            >
              Browse for file…
            </button>
          </div>
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
