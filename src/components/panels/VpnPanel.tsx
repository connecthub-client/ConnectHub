import { useEffect, useState } from "react";
import { VpnProfile, VpnState } from "../../lib/tauri-bridge";
import { useVpnStore } from "../../state/vpnStore";
import { useConfirm } from "../common/useConfirm";
import { EmptyState, listCardClass, PanelScaffold, primaryActionClass, secondaryActionClass } from "../common/PanelScaffold";
import { NavIcon } from "../common/navIcons";

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
    <PanelScaffold title="VPN profiles" description="Securely reach private networks before opening SSH and SFTP sessions." action={<div className="flex gap-2">
          {anyActive && (
            <button
              type="button"
              onClick={handleDisconnectAll}
              disabled={disconnectingAll}
              title="Stuck or forgotten VPN connections? Disconnect everything at once."
              className={secondaryActionClass}
            >
              {disconnectingAll ? "Disconnecting…" : "Disconnect all"}
            </button>
          )}
          <button
            type="button"
            onClick={onNew}
            className={primaryActionClass}
          >
            + New VPN profile
          </button>
        </div>}>

      {!setupInstalled && (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
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
        <EmptyState icon={<NavIcon icon="vpn" className="h-7 w-7" />} title="No VPN profiles" description="Add an .ovpn profile, then assign it to any server that lives on a private network." action={<button type="button" onClick={onNew} className={primaryActionClass}>Add VPN profile</button>} />
      ) : (
        <div className={`${listCardClass} divide-y divide-slate-100 dark:divide-slate-800`}>
          {profiles.map((profile) => {
            const status = statuses[profile.id];
            return (
              <div key={profile.id} className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-300"><NavIcon icon="vpn" className="h-5 w-5" /></div>
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
                </div>
                <div className="flex gap-3 text-sm font-semibold">
                  <button
                    type="button"
                    onClick={() => handleToggle(profile)}
                    disabled={busyId === profile.id || !setupInstalled}
                    className="text-slate-500 hover:text-indigo-600 disabled:opacity-50"
                  >
                    {status?.state === "connected" ? "Disconnect" : "Connect"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onEdit(profile)}
                    className="text-slate-500 hover:text-indigo-600"
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
    </PanelScaffold>
  );
}
