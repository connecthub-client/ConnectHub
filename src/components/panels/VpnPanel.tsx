import { useEffect, useState } from "react";
import { VpnProfile, VpnState } from "../../lib/tauri-bridge";
import { useVpnStore } from "../../state/vpnStore";
import { useConfirm } from "../common/useConfirm";

interface VpnPanelProps {
  onNew: () => void;
  onEdit: (profile: VpnProfile) => void;
}

function statusLabel(state: VpnState | undefined): string {
  switch (state) {
    case "connected":
      return "Connected";
    case "connecting":
      return "Connecting…";
    case "disconnecting":
      return "Disconnecting…";
    case "error":
      return "Error";
    default:
      return "Disconnected";
  }
}

function statusDotClass(state: VpnState | undefined): string {
  switch (state) {
    case "connected":
      return "bg-emerald-500";
    case "connecting":
    case "disconnecting":
      return "bg-amber-500";
    case "error":
      return "bg-red-500";
    default:
      return "bg-slate-400 dark:bg-slate-600";
  }
}

export default function VpnPanel({ onNew, onEdit }: VpnPanelProps) {
  const profiles = useVpnStore((s) => s.profiles);
  const statuses = useVpnStore((s) => s.statuses);
  const setupInstalled = useVpnStore((s) => s.setupInstalled);
  const deleteProfile = useVpnStore((s) => s.deleteProfile);
  const runSetup = useVpnStore((s) => s.runSetup);
  const connect = useVpnStore((s) => s.connect);
  const disconnect = useVpnStore((s) => s.disconnect);
  const disconnectAll = useVpnStore((s) => s.disconnectAll);
  const refreshActive = useVpnStore((s) => s.refreshActive);

  const [settingUp, setSettingUp] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [disconnectingAll, setDisconnectingAll] = useState(false);
  const { confirm, confirmDialog } = useConfirm();

  const anyBusy = Object.values(statuses).some(
    (s) => s.state === "connecting" || s.state === "disconnecting",
  );
  const anyActive = Object.values(statuses).some(
    (s) => s.state === "connected" || s.state === "connecting",
  );
  useEffect(() => {
    if (!anyBusy) return;
    const interval = setInterval(refreshActive, 1500);
    return () => clearInterval(interval);
  }, [anyBusy, refreshActive]);

  async function handleSetup() {
    setSetupError(null);
    setSettingUp(true);
    try {
      await runSetup();
    } catch (e) {
      setSetupError(String(e));
    } finally {
      setSettingUp(false);
    }
  }

  async function handleToggle(profile: VpnProfile) {
    setActionError(null);
    setBusyId(profile.id);
    try {
      if (statuses[profile.id]?.state === "connected") {
        await disconnect(profile.id);
      } else {
        await connect(profile.id);
      }
    } catch (e) {
      setActionError(String(e));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDisconnectAll() {
    setActionError(null);
    setDisconnectingAll(true);
    try {
      await disconnectAll();
    } catch (e) {
      setActionError(String(e));
    } finally {
      setDisconnectingAll(false);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">VPN</h2>
        <div className="flex gap-2">
          {anyActive && (
            <button
              type="button"
              onClick={handleDisconnectAll}
              disabled={disconnectingAll}
              title="Stuck or forgotten VPN connections? Disconnect everything at once."
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {disconnectingAll ? "Disconnecting…" : "Disconnect all"}
            </button>
          )}
          <button
            type="button"
            onClick={onNew}
            className="rounded-lg bg-teal-600 shadow-sm px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700"
          >
            New VPN profile
          </button>
        </div>
      </div>

      {!setupInstalled && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          <p className="mb-2">
            Connecting a VPN needs a one-time privilege setup: it installs a polkit rule scoped
            to launching openvpn, so you aren't prompted for a password on every connect. This
            requires the <code>openvpn</code> package to already be installed on this machine.
          </p>
          <button
            type="button"
            onClick={handleSetup}
            disabled={settingUp}
            className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {settingUp ? "Waiting for authentication…" : "Run one-time setup"}
          </button>
          {setupError && <p className="mt-2 text-red-700 dark:text-red-400">{setupError}</p>}
        </div>
      )}

      {actionError && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{actionError}</p>}

      {profiles.length === 0 ? (
        <p className="text-sm text-slate-400">
          No VPN profiles yet. Add a .ovpn profile to reach hosts on a private network, then
          assign it to any host from that host&apos;s edit form.
        </p>
      ) : (
        <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          {profiles.map((profile) => {
            const status = statuses[profile.id];
            return (
              <div key={profile.id} className="flex items-center justify-between px-4 py-2.5">
                <div>
                  <p className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-slate-100">
                    <span className={`h-1.5 w-1.5 rounded-full ${statusDotClass(status?.state)}`} />
                    {profile.label}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {statusLabel(status?.state)}
                    {status?.state === "error" && status.message ? `: ${status.message}` : ""}
                    {profile.avoid_default_route ? " · Split-tunnel" : " · Full-tunnel"}
                  </p>
                </div>
                <div className="flex gap-3 text-sm">
                  <button
                    type="button"
                    onClick={() => handleToggle(profile)}
                    disabled={busyId === profile.id || !setupInstalled}
                    className="text-slate-500 hover:text-teal-600 disabled:opacity-50"
                  >
                    {status?.state === "connected" ? "Disconnect" : "Connect"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onEdit(profile)}
                    className="text-slate-500 hover:text-teal-600"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      setActionError(null);
                      if (await confirm(`Delete VPN profile "${profile.label}"?`, { danger: true })) {
                        try {
                          await deleteProfile(profile.id);
                        } catch (err) {
                          setActionError(String(err));
                        }
                      }
                    }}
                    className="text-slate-500 hover:text-red-600"
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {confirmDialog}
    </div>
  );
}
