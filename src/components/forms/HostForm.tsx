import { FormEvent, useState } from "react";
import { Host } from "../../lib/tauri-bridge";
import { useHostsStore } from "../../state/hostsStore";
import { errorClass, inputClass, labelClass, primaryButtonClass, selectClass } from "./formStyles";

interface HostFormProps {
  host?: Host;
  defaultGroupId?: string | null;
  onDone: () => void;
}

export default function HostForm({ host, defaultGroupId, onDone }: HostFormProps) {
  const groups = useHostsStore((s) => s.groups);
  const identities = useHostsStore((s) => s.identities);
  const hosts = useHostsStore((s) => s.hosts);
  const createHost = useHostsStore((s) => s.createHost);
  const updateHost = useHostsStore((s) => s.updateHost);

  const [label, setLabel] = useState(host?.label ?? "");
  const [hostname, setHostname] = useState(host?.hostname ?? "");
  const [port, setPort] = useState(host?.port ?? 22);
  const [groupId, setGroupId] = useState(host?.group_id ?? defaultGroupId ?? "");
  const [identityId, setIdentityId] = useState(host?.identity_id ?? "");
  const [jumpHostId, setJumpHostId] = useState(host?.jump_host_id ?? "");
  const [notes, setNotes] = useState(host?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const input = {
        group_id: groupId || null,
        label,
        hostname,
        port,
        identity_id: identityId || null,
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

      <label className={labelClass}>Identity</label>
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
