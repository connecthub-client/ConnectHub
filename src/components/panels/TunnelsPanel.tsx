import { useEffect, useState } from "react";
import { TunnelInfo } from "../../lib/tauri-bridge";
import { useHostsStore } from "../../state/hostsStore";
import { useTunnelsStore } from "../../state/tunnelsStore";
import { useVpnStore } from "../../state/vpnStore";

interface TunnelsPanelProps {
  onNew: () => void;
}

function describeTunnel(tunnel: TunnelInfo, hostLabel: string): string {
  switch (tunnel.kind) {
    case "local":
      return `${tunnel.bind_address}:${tunnel.bind_port} → (via ${hostLabel}) → ${tunnel.target_host}:${tunnel.target_port}`;
    case "remote":
      return `(on ${hostLabel}) ${tunnel.bind_address}:${tunnel.bind_port} → ${tunnel.target_host}:${tunnel.target_port}`;
    case "dynamic":
      return `SOCKS5 proxy on ${tunnel.bind_address}:${tunnel.bind_port} → via ${hostLabel}`;
  }
}

export default function TunnelsPanel({ onNew }: TunnelsPanelProps) {
  const hosts = useHostsStore((s) => s.hosts);
  const tunnels = useTunnelsStore((s) => s.tunnels);
  const loadTunnels = useTunnelsStore((s) => s.loadTunnels);
  const stopTunnel = useTunnelsStore((s) => s.stopTunnel);
  const releaseVpnIfUnused = useVpnStore((s) => s.releaseIfUnused);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadTunnels().catch((e) => setError(String(e)));
  }, [loadTunnels]);

  async function handleStop(tunnel: TunnelInfo) {
    setError(null);
    try {
      await stopTunnel(tunnel.id);
      await releaseVpnIfUnused(tunnel.host_id);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">Tunnels</h2>
        <button
          type="button"
          onClick={onNew}
          className="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700"
        >
          New tunnel
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {tunnels.length === 0 ? (
        <p className="text-sm text-neutral-400">
          No active tunnels. Start a local, remote, or dynamic (SOCKS5) port forward.
        </p>
      ) : (
        <div className="divide-y divide-neutral-200 rounded-md border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {tunnels.map((tunnel) => {
            const host = hosts.find((h) => h.id === tunnel.host_id);
            return (
              <div key={tunnel.id} className="flex items-center justify-between px-4 py-2.5">
                <div>
                  <p className="text-sm font-medium capitalize text-neutral-900 dark:text-neutral-100">
                    {tunnel.kind}
                  </p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    {describeTunnel(tunnel, host?.label ?? "unknown host")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleStop(tunnel)}
                  className="text-sm text-neutral-500 hover:text-red-600"
                >
                  Stop
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
