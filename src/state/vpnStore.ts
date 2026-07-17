import { create } from "zustand";
import * as bridge from "../lib/tauri-bridge";
import type { VpnConnectionStatus, VpnProfile, VpnProfileInput, VpnStatus } from "../lib/tauri-bridge";

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
}

function statusMap(list: VpnConnectionStatus[]): Record<string, VpnStatus> {
  const map: Record<string, VpnStatus> = {};
  for (const c of list) map[c.profile_id] = c.status;
  return map;
}

// Mutations refetch the full profile set afterward, matching hostsStore's
// pattern - connection status is refreshed separately (see refreshActive)
// since it changes independently of the profile records themselves.
export const useVpnStore = create<VpnStoreState>((set, get) => ({
  profiles: [],
  statuses: {},
  setupInstalled: false,
  loaded: false,

  loadAll: async () => {
    const [profiles, active, setupInstalled] = await Promise.all([
      bridge.vpnProfileList(),
      bridge.vpnActiveStatuses(),
      bridge.vpnSetupStatus(),
    ]);
    set({ profiles, statuses: statusMap(active), setupInstalled, loaded: true });
  },

  refreshActive: async () => {
    const active = await bridge.vpnActiveStatuses();
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
}));
