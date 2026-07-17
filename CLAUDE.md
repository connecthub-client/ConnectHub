# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
```bash
npm install
npm run tauri dev          # launches Vite + the Tauri window; Rust changes trigger an automatic rebuild+restart
```

### Building
```bash
npm run build               # frontend only: tsc && vite build
npm run tauri build         # full production bundle (.deb/.AppImage on Linux, output under src-tauri/target/release/bundle/)
```

### Rust backend (run from `src-tauri/`)
```bash
cargo check                             # fast compile check
cargo test --lib                        # unit tests (fast, in-memory SQLite, no network)
cargo test --lib -- --ignored           # live integration tests against a real local sshd (see below)
cargo test --lib <test_name_substring>  # run a single test or module
cargo clippy --lib --no-default-features
```

### Frontend
```bash
npx tsc --noEmit    # type-check only
```

There is no configured lint/format command for the frontend beyond `tsc`.

## Live integration tests

Tests under `*::live_sshd_tests` modules (in `ssh/session.rs`, `ssh/sftp.rs`, `ssh/tunnel.rs`, `ssh/exec.rs`) are marked `#[ignore]` and connect to a **real local `sshd` on port 22** using a dedicated throwaway SSH keypair whose public half is appended to `~/.ssh/authorized_keys`. They hardcode the private key path to a location under the Claude session's scratchpad directory — when regenerating this environment, recreate that keypair and authorized_keys entry before running `cargo test --lib -- --ignored`, and never reuse or touch the real `~/.ssh` keys already present on the machine.

## Architecture

Tauri 2 desktop app: Rust backend (`src-tauri/`) exposes `#[tauri::command]` functions; React frontend (`src/`) calls them exclusively through a typed bridge layer, never `invoke()` directly from components.

### Backend layering (`src-tauri/src/`)
- `commands/*_commands.rs` — thin `#[tauri::command]` wrappers. They lock `state.db`/`state.vault_key` and delegate to `data/`; no business logic lives here.
- `data/*.rs` — CRUD and domain logic against SQLite (`rusqlite`), one module per entity (`hosts`, `groups`, `identities`, `ssh_keys`, `snippets`, `vpn_profiles`, `host_csv`). Each has its own `#[cfg(test)] mod tests` using an in-memory `Connection`.
- `models/*.rs` — plain `Host`/`Identity`/`SshKey`/etc. structs plus their `*Input` create/update counterparts (serde `Deserialize`, snake_case fields — Tauri does NOT camelCase these).
- `ssh/*.rs` — the actual SSH functionality via `russh`/`russh-sftp`/`fast-socks5`: `session.rs` (interactive PTY sessions + the shared `connect_and_authenticate` helper reused by SFTP/tunnels/exec), `sftp.rs`, `tunnel.rs` (local/remote/dynamic port forwarding), `exec.rs` (one-off command execution, used by snippets' run-on-hosts), `known_hosts.rs` (TOFU host-key pinning).
- `vault/` — `kdf.rs` (Argon2id), `crypto.rs` (AES-256-GCM field-level encrypt/decrypt), `store.rs` (vault create/unlock/auto-unlock, the per-install local secret, and the one-time legacy-password migration; resolves the SQLite db path).
- `google/` — `oauth.rs` (PKCE authorization-code flow via a loopback `TcpListener`, token exchange/refresh), `drive.rs` (`appDataFolder` upload/download/find via Drive API v3), `mod.rs` (ties both together into `login`/`backup_now`/`restore_from_drive`, called by `commands/backup_commands.rs`).
- `vpn/` — `setup.rs` (installs a narrowly-scoped polkit rule + helper script so openvpn can be launched as root without a per-connect password prompt), `mod.rs` (spawns/tracks live openvpn processes per profile via `VpnMap`, an `Arc<DashMap<Uuid, ActiveVpn>>` keyed by profile id, controlled over openvpn's local TCP management interface rather than OS signals - see "VPN profiles" below).
- `state.rs` — `AppState`: holds the `Mutex<Connection>`, the in-memory `Mutex<Option<VaultKey>>`, and `DashMap`s of live SSH/SFTP/tunnel sessions keyed by UUID.
- `error.rs` — single `AppError` enum (`thiserror`) shared by every command; serializes to a plain string for the frontend.

New commands must be registered in **two** places in `lib.rs`: the `use commands::...` import list and the `tauri::generate_handler![...]` macro call — easy to forget the second one.

### Data model
`Group` (nested via `parent_id`) → `Host` (references `Identity`, optional `jump_host_id` pointing at another `Host` for ProxyJump chaining, optional `vpn_profile_id` pointing at a `VpnProfile`) → `Identity` (username + auth method, references `SshKey`) → `SshKey`. Plus standalone `Snippet` and `VpnProfile`, and a single-row `google_auth` table (see below). `hosts.vpn_profile_id` was added after the table already existed in shipped databases, so `data::init_schema` backfills it by hand (`add_column_if_missing`) rather than relying on `CREATE TABLE IF NOT EXISTS`, which is a no-op against an existing table - the pattern to follow if a future column needs adding to an existing table again.

Only secrets are encrypted at the field level (identity passwords, private keys, key passphrases) via AES-256-GCM; everything else (labels, hostnames, ports, notes) is plaintext in SQLite for fast querying. `host_csv.rs` exports/imports this data model as CSV — it deliberately excludes all secret material, matching identities on the importing side by username/label rather than re-creating credentials.

### Vault / "master password"
There is **no user-facing master password**. `App.tsx` calls `vault_auto_unlock` on launch, which (`vault/store.rs::auto_unlock`) unlocks using a random secret generated once per installation and stored at `~/.local/share/sshtool/.local_secret` (`0600` permissions, never committed to source). If a vault was created before this scheme existed, `auto_unlock` transparently falls back to the old hardcoded password, then runs `migrate_to_new_secret` once to re-encrypt every identity/key secret under the new per-install key and retire the old password — this migration path must not be removed while any user could still be on the old scheme. The Argon2id/AES-256-GCM machinery in `vault/` is otherwise unchanged. The SQLite file lives at `dirs::data_dir()/sshtool/vault.db` (hardcoded literal `"sshtool"` in `vault/store.rs::db_path`, independent of the Tauri app identifier/product name — renaming the app in `tauri.conf.json` does not move or affect this path).

### VPN profiles
`Host.vpn_profile_id` is a nullable FK to `vpn_profiles` (many hosts can share one profile - e.g. one office VPN unlocking a whole private subnet). Connecting requires root (a new tun interface + routes), which the app never has directly, so `vpn::connect` shells out via `pkexec` to a helper script installed once by `vpn::setup::install()` - see the VPN setup section in the README for the full rationale. The helper re-validates its own arguments at runtime (config/auth files must live under the calling user's own `~/.local/share/sshtool/vpn-profiles/`, looked up via `$PKEXEC_UID` since pkexec resets `$HOME`) and unconditionally forces `--script-security 0`, so an uploaded `.ovpn`'s `up`/`down`/`route-up` directives can never execute code as root regardless of what's in the file - that flag, not the polkit rule itself, is the actual security boundary. Once running, `vpn::mod.rs` controls the (root-owned) openvpn process over its local TCP **management interface** rather than OS signals, since an unprivileged process can't `kill()` a root-owned one: connecting opens a `127.0.0.1` socket openvpn was told to bind, sends `state on` to get async `>STATE:...` notifications, and disconnecting sends `signal SIGTERM` over that same socket. `vpn::connect` blocks (with a timeout) until the first CONNECTED/error transition so the frontend gets a definitive result instead of polling, while a background task keeps monitoring the socket afterward so a later status query reflects an unexpected drop. `src/components/panels/HostContextPanel.tsx`'s fourth **VPN** button toggles this per-host; Connect/SFTP/Tunnel are wrapped in a `guardedAction` that offers to bring the VPN up first if the host's assigned profile isn't connected, rather than silently timing out against an unreachable private IP.

### Google Drive backup
Settings → Backup lets a user sign in with their own Google account (OAuth2 PKCE, loopback redirect, `google/oauth.rs`) and back up/restore the **entire vault file** plus the local secret to a hidden Drive `appDataFolder` (`google/drive.rs`), invisible in the user's normal Drive UI and readable only by this app. `google/mod.rs::backup_now` snapshots the live SQLite connection via `rusqlite::backup::Backup` (not a raw file read, since another connection has the file open) before uploading; `restore_from_drive` downloads both files, temporarily swaps `AppState.db` to an in-memory connection to release the file handle, overwrites the real db file and local secret, reopens, and re-runs `auto_unlock`. The refresh token is stored *inside* the vault (`google_auth` table) so it survives a restore. **`google::oauth::CLIENT_ID`/`CLIENT_SECRET` are placeholders** — sign-in will fail with an invalid-client error until a real Google Cloud OAuth "Desktop app" client's credentials are substituted in; this is a per-deployment setup step, not something to build around.

### Frontend (`src/`)
- `lib/tauri-bridge/` — one file per domain, each just wrapping `invoke("command_name", { args })`; `types.ts` holds the shared TS interfaces mirroring the Rust models. Always add new bridge functions here rather than calling `invoke` from components.
- `state/*Store.ts` — zustand stores. Mutations generally `await` the backend call then re-fetch the full collection (`loadAll()`) rather than patching state in place, since collections are small and this sidesteps subtle bugs from `ON DELETE SET NULL` cascades. `settingsStore.ts`'s theme defaults to `"dark"`.
- `pages/AppShell.tsx` — the main layout/router-equivalent: owns `mainView` (which manage-tab or which open session tab is active) and `modal` (which create/edit form is open) as local state; every panel/form is a controlled child. It also derives `contextHost` (the host shown in the right-side panel) by looking it up **live** from the `hosts` array by id — never hold onto a session's captured `host` snapshot directly for display, since fields like `last_connected_at` change after the snapshot was taken.
- `components/panels/HostContextPanel.tsx` — persistent right-side panel for the selected/active host: Connect/SFTP/Tunnel actions, details, live session status, and **Quick Commands** (runs a saved snippet against just this host via the existing `snippetRunOnHosts` exec pathway, showing the single result inline). Replaces the old page-style `HostDetail` component.
- `components/panels/GoogleBackupSection.tsx` — the Settings → Backup UI (sign in/out, back up now, restore) built on `lib/tauri-bridge/backup.ts`; a destructive restore requires an explicit `confirm()` and reloads the window afterward rather than trying to patch every zustand store in place.
- `state/vpnStore.ts` + `components/panels/VpnPanel.tsx` / `components/forms/VpnProfileForm.tsx` — VPN profile CRUD follows the `hostsStore.ts` refetch-after-mutation pattern, but connection status (`statuses: Record<profileId, VpnStatus>`) is tracked and refreshed separately via `refreshActive()`/`vpn_active_statuses`, since it changes independently (and asynchronously, mid-connect) from the profile records themselves. Both `VpnPanel` and `HostContextPanel` poll `refreshActive` on a short interval only while at least one profile is `connecting`/`disconnecting`, not continuously.
- `components/common/Modal.tsx` — the backdrop itself scrolls (`overflow-y-auto` on the fixed wrapper, `mx-auto my-8` instead of `flex items-center` on the dialog box) rather than the dialog box being vertically centered with no scroll path - centering-without-scroll was found to make a sufficiently tall form (`HostForm` once the VPN profile field was added) unreachable from its top on an 800x600 window, with no way to scroll up to it. Keep this in mind for any future modal content that could grow tall.
- `components/terminal/TerminalView.tsx` + `components/sftp/SftpBrowser.tsx` — one instance per open session tab, kept mounted (via CSS `visibility`, not `display:none`/unmount) while switching tabs so the SSH connection and xterm.js scrollback survive. `display:none` was tried first and silently drops the most recent scrollback line in WebKitGTK — don't reintroduce it.
- `components/sidebar/HostTree.tsx` — double-click a host row to connect (only if it has an identity); right-click opens a small custom context menu (Connect/Duplicate/Edit/Delete) built with a `useEffect` closing it on any outside click/contextmenu/keydown; a status dot per row reflects whether a session is currently open for that host.
- Native file dialogs use `@tauri-apps/plugin-dialog` (`open`/`save`); reading/writing the chosen path goes through `local_read_text_file`/`local_write_text_file` Tauri commands rather than the `fs` plugin, matching the existing `local_fs_commands.rs` pattern.
- Color palette is teal-accented and dark-first (not blue) — reuse `teal-*` Tailwind classes for new interactive elements rather than introducing another accent color.

### Known WebKitGTK quirks (Linux)
- Native `<select>` elements render using the OS GTK theme rather than the page's CSS and can end up with unreadable (e.g. white-on-white) text when the app's theme diverges from the system theme. Fixed via the `.themed-select` CSS class (`App.css`) + `appearance: none` with a hand-drawn arrow — reuse this class for any new `<select>`, don't rely on native styling.
- `color-scheme` must be set explicitly (`App.tsx`'s theme effect) for native form controls to follow the app's manual light/dark override instead of the OS preference.
