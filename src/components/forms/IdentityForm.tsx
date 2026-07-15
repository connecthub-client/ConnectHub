import { FormEvent, useState } from "react";
import { AuthMethod, Identity } from "../../lib/tauri-bridge";
import { useHostsStore } from "../../state/hostsStore";
import { errorClass, inputClass, labelClass, primaryButtonClass, selectClass } from "./formStyles";

interface IdentityFormProps {
  identity?: Identity;
  onDone: () => void;
}

export default function IdentityForm({ identity, onDone }: IdentityFormProps) {
  const keys = useHostsStore((s) => s.keys);
  const createIdentity = useHostsStore((s) => s.createIdentity);
  const updateIdentity = useHostsStore((s) => s.updateIdentity);

  const [label, setLabel] = useState(identity?.label ?? "");
  const [username, setUsername] = useState(identity?.username ?? "");
  const [authMethod, setAuthMethod] = useState<AuthMethod>(identity?.auth_method ?? "password");
  const [sshKeyId, setSshKeyId] = useState(identity?.ssh_key_id ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const input = {
        label,
        username,
        auth_method: authMethod,
        ssh_key_id: authMethod === "private_key" ? sshKeyId || null : null,
        // Leave the stored password untouched on update unless the user typed
        // something in this session; on create, empty just means no password.
        password: password || (identity ? null : ""),
      };
      if (identity) {
        await updateIdentity(identity.id, input);
      } else {
        await createIdentity(input);
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
      <label className={labelClass}>Label</label>
      <input
        autoFocus
        value={label}
        onChange={(e) => setLabel(e.currentTarget.value)}
        className={inputClass}
        placeholder="e.g. prod deploy user"
        required
      />

      <label className={labelClass}>Username</label>
      <input
        value={username}
        onChange={(e) => setUsername(e.currentTarget.value)}
        className={inputClass}
        required
      />

      <label className={labelClass}>Authentication method</label>
      <select
        value={authMethod}
        onChange={(e) => setAuthMethod(e.currentTarget.value as AuthMethod)}
        className={selectClass}
      >
        <option value="password">Password</option>
        <option value="private_key">Private key</option>
        <option value="agent">SSH agent</option>
      </select>

      {authMethod === "password" && (
        <>
          <label className={labelClass}>
            Password{identity?.has_password ? " (leave blank to keep current)" : ""}
          </label>
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            className={inputClass}
          />
        </>
      )}

      {authMethod === "private_key" && (
        <>
          <label className={labelClass}>SSH key</label>
          <select
            value={sshKeyId}
            onChange={(e) => setSshKeyId(e.currentTarget.value)}
            className={selectClass}
            required
          >
            <option value="" disabled>
              Select a key…
            </option>
            {keys.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label} ({k.key_type})
              </option>
            ))}
          </select>
        </>
      )}

      {error && <p className={errorClass}>{error}</p>}

      <button type="submit" disabled={submitting} className={primaryButtonClass}>
        {submitting ? "Saving…" : identity ? "Save changes" : "Create identity"}
      </button>
    </form>
  );
}
