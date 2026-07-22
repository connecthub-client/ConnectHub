export interface Group {
  id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
}

export interface GroupInput {
  parent_id: string | null;
  name: string;
  sort_order: number;
}

export type AuthMethod = "password" | "private_key" | "agent";

export interface Identity {
  id: string;
  label: string;
  username: string;
  auth_method: AuthMethod;
  ssh_key_id: string | null;
  has_password: boolean;
}

export interface IdentityInput {
  label: string;
  username: string;
  auth_method: AuthMethod;
  ssh_key_id: string | null;
  // undefined/null = leave existing password unchanged (on update).
  // "" = clear it. Any other string = set/replace it.
  password: string | null;
}

export interface SshKey {
  id: string;
  label: string;
  key_type: string;
  public_key: string;
  fingerprint: string;
  created_at: string;
}

export interface GenerateKeyInput {
  label: string;
}

export interface ImportKeyInput {
  label: string;
  private_key_pem: string;
  passphrase: string | null;
}

export interface Host {
  id: string;
  group_id: string | null;
  label: string;
  hostname: string;
  port: number;
  identity_id: string | null;
  vpn_profile_id: string | null;
  color: string | null;
  // Preset icon key (see HOST_ICONS in components/common/hostIcons.tsx) -
  // not a file path or image data, just a fixed identifier.
  icon: string | null;
  notes: string | null;
  sort_order: number;
  last_connected_at: string | null;
  is_favorite: boolean;
}

export interface HostInput {
  group_id: string | null;
  label: string;
  hostname: string;
  port: number;
  identity_id: string | null;
  vpn_profile_id: string | null;
  color: string | null;
  icon: string | null;
  notes: string | null;
  sort_order: number;
}

export interface HostStats {
  cpu_percent: number;
  mem_used_mb: number;
  mem_total_mb: number;
  rx_bytes: number;
  tx_bytes: number;
  swap_used_mb: number;
  swap_total_mb: number;
  disk_used_mb: number;
  disk_total_mb: number;
}

export interface ImportSummary {
  imported: number;
  updated: number;
  warnings: string[];
}

export interface VpnProfile {
  id: string;
  label: string;
  config: string;
  auth_username: string | null;
  has_auth_password: boolean;
  // If true, this profile can't take over the default route even if its
  // server pushes one - lets multiple profiles stay connected at once
  // without fighting over "the internet". See vpn::connect (Rust).
  avoid_default_route: boolean;
  created_at: string;
}

export interface VpnProfileInput {
  label: string;
  config: string;
  auth_username: string | null;
  // undefined/null = leave existing password unchanged (on update).
  // "" = clear it. Any other string = set/replace it.
  auth_password: string | null;
  avoid_default_route: boolean;
}

export type VpnState = "connecting" | "connected" | "disconnecting" | "disconnected" | "error";

export interface VpnStatus {
  state: VpnState;
  message: string | null;
}

export interface VpnConnectionStatus {
  profile_id: string;
  status: VpnStatus;
}
