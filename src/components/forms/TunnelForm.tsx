import { FormEvent, useState } from "react";
import { TunnelKind } from "../../lib/tauri-bridge";
import { useHostsStore } from "../../state/hostsStore";
import { useTunnelsStore } from "../../state/tunnelsStore";
import { errorClass, inputClass, labelClass, primaryButtonClass, selectClass } from "./formStyles";

interface TunnelFormProps {
  defaultHostId?: string;
  onDone: () => void;
}

export default function TunnelForm({ defaultHostId, onDone }: TunnelFormProps) {
  const hosts = useHostsStore((s) => s.hosts);
  const startTunnel = useTunnelsStore((s) => s.startTunnel);

  const [hostId, setHostId] = useState(defaultHostId ?? "");
  const [kind, setKind] = useState<TunnelKind>("local");
  const [bindAddress, setBindAddress] = useState("127.0.0.1");
  const [bindPort, setBindPort] = useState(8080);
  const [targetHost, setTargetHost] = useState("");
  const [targetPort, setTargetPort] = useState(80);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await startTunnel({
        host_id: hostId,
        kind,
        bind_address: bindAddress,
        bind_port: bindPort,
        target_host: kind === "dynamic" ? null : targetHost,
        target_port: kind === "dynamic" ? null : targetPort,
      });
      onDone();
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <label className={labelClass}>Host</label>
      <select
        value={hostId}
        onChange={(e) => setHostId(e.currentTarget.value)}
        className={selectClass}
        required
      >
        <option value="" disabled>
          Select a host…
        </option>
        {hosts.map((h) => (
          <option key={h.id} value={h.id}>
            {h.label}
          </option>
        ))}
      </select>

      <label className={labelClass}>Type</label>
      <select
        value={kind}
        onChange={(e) => setKind(e.currentTarget.value as TunnelKind)}
        className={selectClass}
      >
        <option value="local">Local — reach a remote-side address from this machine</option>
        <option value="remote">Remote — let the server reach back to this machine</option>
        <option value="dynamic">Dynamic (SOCKS5) — proxy arbitrary traffic through the host</option>
      </select>

      <div className="flex gap-3">
        <div className="flex-1">
          <label className={labelClass}>Bind address</label>
          <input
            value={bindAddress}
            onChange={(e) => setBindAddress(e.currentTarget.value)}
            className={inputClass}
            required
          />
        </div>
        <div className="w-28">
          <label className={labelClass}>Bind port</label>
          <input
            type="number"
            min={1}
            max={65535}
            value={bindPort}
            onChange={(e) => setBindPort(Number(e.currentTarget.value))}
            className={inputClass}
            required
          />
        </div>
      </div>

      {kind !== "dynamic" && (
        <div className="flex gap-3">
          <div className="flex-1">
            <label className={labelClass}>
              {kind === "local" ? "Target host (from the server)" : "Target host (from this machine)"}
            </label>
            <input
              value={targetHost}
              onChange={(e) => setTargetHost(e.currentTarget.value)}
              className={inputClass}
              placeholder="e.g. localhost or 10.0.0.5"
              required
            />
          </div>
          <div className="w-28">
            <label className={labelClass}>Target port</label>
            <input
              type="number"
              min={1}
              max={65535}
              value={targetPort}
              onChange={(e) => setTargetPort(Number(e.currentTarget.value))}
              className={inputClass}
              required
            />
          </div>
        </div>
      )}

      {error && <p className={errorClass}>{error}</p>}

      <button type="submit" disabled={submitting} className={primaryButtonClass}>
        {submitting ? "Starting…" : "Start tunnel"}
      </button>
    </form>
  );
}
