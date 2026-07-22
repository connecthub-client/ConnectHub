import { create } from "zustand";
import * as bridge from "../lib/tauri-bridge";
import type { VpnConnectionStatus, VpnProfile, VpnProfileInput, VpnStatus } from "../lib/tauri-bridge";
import { useHostsStore } from "./hostsStore";
import { useSessionsStore } from "./sessionsStore";

interface VpnStoreState {
  profiles: VpnProfile[];
  statuses: Record<string, VpnStatus>;
  setupInstalled: boolean;
  loaded: boolean;

  loadAll: () => Promise<void>;
  refreshActive: () => Promise<void>;

  createProfile: (input: VpnProfileInput) => Promise<VpnProfile>;
  updateProfile: (id: string, input: VpnProfileInput) => Promise<VpnProfile>;
  deleteProfile: (id: string) => Promise<void>;

  runSetup: () => Promise<void>;
  connect: (profileId: string) => Promise<VpnStatus>;
  disconnect: (profileId: string) => Promise<void>;
  // Disconnects the VPN a host relies on, but only once nothing else (an
  // open terminal/SFTP session) still needs it - safe to call every time a
  // session closes, regardless of what else is sharing that same profile.
  releaseIfUnused: (hostId: string) => Promise<void>;
  // Manual recovery valve: signals every connected/connecting profile to
  // shut down, for the rare case one gets stuck (e.g. an SSH session that
  // never registered its VPN usage, or a profile left over from a crash).
  disconnectAll: () => Promise<void>;
}

function statusMap(list: VpnConnectionStatus[]): Record<string, VpnStatus> {
  const map: Record<string, VpnStatus> = {};
  for (const c of list) map[c.profile_id] = c.status;
  return map;
}

// Shared by loadAll and refreshActive below (both write `statuses`, among
// other fields) - guards against either resolving out of order relative to
// the other, e.g. a poll-driven refreshActive() overlapping a mutation's
// loadAll(). Whichever call started most recently wins; a call whose
// response arrives after a newer one has already started is discarded
// instead of overwriting fresher state with a stale snapshot.
let requestId = 0;

// Mutations refetch the full profile set afterward, matching hostsStore's
// pattern - connection status is refreshed separately (see refreshActive)
// since it changes independently of the profile records themselves.
export const useVpnStore = create<VpnStoreState>((set, get) => ({
  profiles: [],
  statuses: {},
  setupInstalled: false,
  loaded: false,

  loadAll: async () => {
    const thisRequest = ++requestId;
    const [profiles, active, setupInstalled] = await Promise.all([
      bridge.vpnProfileList(),
      bridge.vpnActiveStatuses(),
      bridge.vpnSetupStatus(),
    ]);
    if (thisRequest !== requestId) return;
    set({ profiles, statuses: statusMap(active), setupInstalled, loaded: true });
  },

  refreshActive: async () => {
    const thisRequest = ++requestId;
    const active = await bridge.vpnActiveStatuses();
    if (thisRequest !== requestId) return;
    set({ statuses: statusMap(active) });
  },

  createProfile: async (input) => {
    const profile = await bridge.vpnProfileCreate(input);
    await get().loadAll();
    return profile;
  },
  updateProfile: async (id, input) => {
    const profile = await bridge.vpnProfileUpdate(id, input);
    await get().loadAll();
    return profile;
  },
  deleteProfile: async (id) => {
    await bridge.vpnProfileDelete(id);
    await get().loadAll();
  },

  runSetup: async () => {
    await bridge.vpnSetupInstall();
    const setupInstalled = await bridge.vpnSetupStatus();
    set({ setupInstalled });
  },

  connect: async (profileId) => {
    set((s) => ({
      statuses: { ...s.statuses, [profileId]: { state: "connecting", message: null } },
    }));
    const status = await bridge.vpnConnect(profileId);
    set((s) => ({ statuses: { ...s.statuses, [profileId]: status } }));
    return status;
  },
  disconnect: async (profileId) => {
    await bridge.vpnDisconnect(profileId);
    set((s) => ({
      statuses: { ...s.statuses, [profileId]: { state: "disconnecting", message: null } },
    }));
  },

  releaseIfUnused: async (hostId) => {
    const hosts = useHostsStore.getState().hosts;
    const host = hosts.find((h) => h.id === hostId);
    const profileId = host?.vpn_profile_id;
    if (!profileId) return;

    const status = get().statuses[profileId];
    if (status?.state !== "connected" && status?.state !== "connecting") return;

    const stillUsedBySession = useSessionsStore
      .getState()
      .openSessions.some((s) => s.host.vpn_profile_id === profileId);
    if (stillUsedBySession) return;

    await get().disconnect(profileId);
  },

  disconnectAll: async () => {
    await bridge.vpnDisconnectAll();
    set((s) => ({
      statuses: Object.fromEntries(
        Object.entries(s.statuses).map(([id, status]) => [
          id,
          status.state === "connected" || status.state === "connecting"
            ? { state: "disconnecting" as const, message: null }
            : status,
        ]),
      ),
    }));
  },
}));
