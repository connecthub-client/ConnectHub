import { FormEvent, useState } from "react";
import { AuthMethod, Host } from "../../lib/tauri-bridge";
import { useHostsStore } from "../../state/hostsStore";
import { errorClass, inputClass, labelClass, primaryButtonClass, selectClass } from "./formStyles";

interface HostFormProps {
  host?: Host;
  defaultGroupId?: string | null;
  onDone: () => void;
}

type InlineAuthMethod = Extract<AuthMethod, "password" | "private_key">;

export default function HostForm({ host, defaultGroupId, onDone }: HostFormProps) {
  const groups = useHostsStore((s) => s.groups);
  const identities = useHostsStore((s) => s.identities);
  const keys = useHostsStore((s) => s.keys);
  const hosts = useHostsStore((s) => s.hosts);
  const createHost = useHostsStore((s) => s.createHost);
  const updateHost = useHostsStore((s) => s.updateHost);
  const createIdentity = useHostsStore((s) => s.createIdentity);

  const [label, setLabel] = useState(host?.label ?? "");
  const [hostname, setHostname] = useState(host?.hostname ?? "");
  const [port, setPort] = useState(host?.port ?? 22);
  const [groupId, setGroupId] = useState(host?.group_id ?? defaultGroupId ?? "");

  const [identityMode, setIdentityMode] = useState<"new" | "existing">(
    host?.identity_id ? "existing" : "new",
  );
  const [identityId, setIdentityId] = useState(host?.identity_id ?? "");
  const [username, setUsername] = useState("");
  const [authMethod, setAuthMethod] = useState<InlineAuthMethod>("password");
  const [password, setPassword] = useState("");
  const [sshKeyId, setSshKeyId] = useState("");

  const [jumpHostId, setJumpHostId] = useState(host?.jump_host_id ?? "");
  const [notes, setNotes] = useState(host?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (identityMode === "new" && authMethod === "private_key" && !sshKeyId) {
      setError("Select an SSH key, or generate/import one in the Keys tab first.");
      return;
    }

    setSubmitting(true);
    try {
      let resolvedIdentityId = identityMode === "existing" ? identityId || null : null;

      if (identityMode === "new" && username) {
        const identity = await createIdentity({
          label: `${username}@${hostname || label}`,
          username,
          auth_method: authMethod,
          ssh_key_id: authMethod === "private_key" ? sshKeyId : null,
          password: authMethod === "password" ? password : "",
        });
        resolvedIdentityId = identity.id;
      }

      const input = {
        group_id: groupId || null,
        label,
        hostname,
        port,
        identity_id: resolvedIdentityId,
        jump_host_id: jumpHostId || null,
        color: host?.color ?? null,
        notes: notes || null,
        sort_order: host?.sort_order ?? 0,
      };
      if (host) {
        await updateHost(host.id, input);
      } else {
        await createHost(input);
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
        placeholder="e.g. prod-web-1"
        required
      />

      <div className="flex gap-3">
        <div className="flex-1">
          <label className={labelClass}>Hostname / IP</label>
          <input
            value={hostname}
            onChange={(e) => setHostname(e.currentTarget.value)}
            className={inputClass}
            required
          />
        </div>
        <div className="w-24">
          <label className={labelClass}>Port</label>
          <input
            type="number"
            min={1}
            max={65535}
            value={port}
            onChange={(e) => setPort(Number(e.currentTarget.value))}
            className={inputClass}
            required
          />
        </div>
      </div>

      <label className={labelClass}>Group</label>
      <select
        value={groupId}
        onChange={(e) => setGroupId(e.currentTarget.value)}
        className={selectClass}
      >
        <option value="">(none - top level)</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>

      <label className={labelClass}>Credentials</label>
      {identities.length > 0 && (
        <div className="mb-4 flex rounded-md border border-neutral-300 p-1 text-sm dark:border-neutral-700">
          <button
            type="button"
            onClick={() => setIdentityMode("new")}
            className={`flex-1 rounded px-3 py-1.5 ${identityMode === "new" ? "bg-teal-600 text-white" : "text-neutral-600 dark:text-neutral-300"}`}
          >
            New credentials
          </button>
          <button
            type="button"
            onClick={() => setIdentityMode("existing")}
            className={`flex-1 rounded px-3 py-1.5 ${identityMode === "existing" ? "bg-teal-600 text-white" : "text-neutral-600 dark:text-neutral-300"}`}
          >
            Use saved identity
          </button>
        </div>
      )}

      {identityMode === "existing" ? (
        <select
          value={identityId}
          onChange={(e) => setIdentityId(e.currentTarget.value)}
          className={selectClass}
        >
          <option value="">(none)</option>
          {identities.map((i) => (
            <option key={i.id} value={i.id}>
              {i.label} ({i.username})
            </option>
          ))}
        </select>
      ) : (
        <div className="mb-4 rounded-md border border-neutral-200 p-3 dark:border-neutral-700">
          <label className={labelClass}>Username</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.currentTarget.value)}
            className={inputClass}
            placeholder="e.g. root"
          />

          <label className={labelClass}>Authentication</label>
          <div className="mb-4 flex gap-4 text-sm text-neutral-700 dark:text-neutral-300">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={authMethod === "password"}
                onChange={() => setAuthMethod("password")}
              />
              Password
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={authMethod === "private_key"}
                onChange={() => setAuthMethod("private_key")}
              />
              Private key
            </label>
          </div>

          {authMethod === "password" ? (
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
              className={inputClass}
              placeholder="Password"
            />
          ) : keys.length > 0 ? (
            <select
              value={sshKeyId}
              onChange={(e) => setSshKeyId(e.currentTarget.value)}
              className={selectClass}
            >
              <option value="">Select a key…</option>
              {keys.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label} ({k.key_type})
                </option>
              ))}
            </select>
          ) : (
            <p className="mb-4 text-sm text-neutral-400">
              No SSH keys yet - generate or import one in the Keys tab first.
            </p>
          )}
        </div>
      )}

      <label className={labelClass}>Jump host (ProxyJump)</label>
      <select
        value={jumpHostId}
        onChange={(e) => setJumpHostId(e.currentTarget.value)}
        className={selectClass}
      >
        <option value="">(none)</option>
        {hosts
          .filter((h) => h.id !== host?.id)
          .map((h) => (
            <option key={h.id} value={h.id}>
              {h.label}
            </option>
          ))}
      </select>

      <label className={labelClass}>Notes</label>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.currentTarget.value)}
        className={`${inputClass} h-20`}
      />

      {error && <p className={errorClass}>{error}</p>}

      <button type="submit" disabled={submitting} className={primaryButtonClass}>
        {submitting ? "Saving…" : host ? "Save changes" : "Create host"}
      </button>
    </form>
  );
}
