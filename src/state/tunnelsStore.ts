import { create } from "zustand";
import { TunnelInfo, TunnelInput, tunnelList, tunnelStart, tunnelStop } from "../lib/tauri-bridge";

interface TunnelsState {
  tunnels: TunnelInfo[];
  loadTunnels: () => Promise<void>;
  startTunnel: (input: TunnelInput) => Promise<string>;
  stopTunnel: (tunnelId: string) => Promise<void>;
}

export const useTunnelsStore = create<TunnelsState>((set, get) => ({
  tunnels: [],

  loadTunnels: async () => {
    const tunnels = await tunnelList();
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
