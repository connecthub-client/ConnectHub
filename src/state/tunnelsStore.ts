import { create } from "zustand";
import { TunnelInfo, TunnelInput, tunnelList, tunnelStart, tunnelStop } from "../lib/tauri-bridge";

interface TunnelsState {
  tunnels: TunnelInfo[];
  loadTunnels: () => Promise<void>;
  startTunnel: (input: TunnelInput) => Promise<string>;
  stopTunnel: (tunnelId: string) => Promise<void>;
}

// Guards against overlapping loadTunnels() calls resolving out of order and
// overwriting fresher state with a stale snapshot - same reasoning as
// hostsStore's loadRequestId.
let loadRequestId = 0;

export const useTunnelsStore = create<TunnelsState>((set, get) => ({
  tunnels: [],

  loadTunnels: async () => {
    const requestId = ++loadRequestId;
    const tunnels = await tunnelList();
    if (requestId !== loadRequestId) return;
    set({ tunnels });
  },

  startTunnel: async (input) => {
    const id = await tunnelStart(input);
    await get().loadTunnels();
    return id;
  },

  stopTunnel: async (tunnelId) => {
    await tunnelStop(tunnelId);
    await get().loadTunnels();
  },
}));
