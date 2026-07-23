import { invoke } from "@tauri-apps/api/core";
import { VpnConnectionStatus, VpnProfile, VpnProfileInput, VpnStatus } from "./types";

export function vpnProfileList(): Promise<VpnProfile[]> {
  return invoke("vpn_profile_list");
}

export function vpnProfileCreate(input: VpnProfileInput): Promise<VpnProfile> {
  return invoke("vpn_profile_create", { input });
}

export function vpnProfileUpdate(id: string, input: VpnProfileInput): Promise<VpnProfile> {
  return invoke("vpn_profile_update", { id, input });
}

export function vpnProfileDelete(id: string): Promise<void> {
  return invoke("vpn_profile_delete", { id });
}

export function vpnSetupStatus(): Promise<boolean> {
  return invoke("vpn_setup_status");
}

export function vpnSetupInstall(): Promise<void> {
  return invoke("vpn_setup_install");
}

export function vpnConnect(profileId: string): Promise<VpnStatus> {
  return invoke("vpn_connect", { profileId });
}

export function vpnDisconnect(profileId: string): Promise<void> {
  return invoke("vpn_disconnect", { profileId });
}

export function vpnStatus(profileId: string): Promise<VpnStatus> {
  return invoke("vpn_status", { profileId });
}

export function vpnActiveStatuses(): Promise<VpnConnectionStatus[]> {
  return invoke("vpn_active_statuses");
}

export function vpnDisconnectAll(): Promise<void> {
  return invoke("vpn_disconnect_all");
}

// Call whenever a host's VPN profile is already connected (so vpnConnect
// itself is never invoked) - covers a host added to/assigned that profile
// after the VPN came up, which would otherwise never get its own /32
// route until the VPN is manually disconnected and reconnected. See
// vpn::ensure_host_route's doc comment in the Rust backend.
export function vpnEnsureHostRoute(hostId: string): Promise<void> {
  return invoke("vpn_ensure_host_route", { hostId });
}
