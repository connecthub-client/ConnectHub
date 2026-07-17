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
- `data/*.rs` — CRUD and domain logic against SQLite (`rusqlite`), one module per entity (`hosts`, `groups`, `identities`, `ssh_keys`, `snippets`, `host_csv`). Each has its own `#[cfg(test)] mod tests` using an in-memory `Connection`.
- `models/*.rs` — plain `Host`/`Identity`/`SshKey`/etc. structs plus their `*Input` create/update counterparts (serde `Deserialize`, snake_case fields — Tauri does NOT camelCase these).
- `ssh/*.rs` — the actual SSH functionality via `russh`/`russh-sftp`/`fast-socks5`: `session.rs` (interactive PTY sessions + the shared `connect_and_authenticate` helper reused by SFTP/tunnels/exec), `sftp.rs`, `tunnel.rs` (local/remote/dynamic port forwarding), `exec.rs` (one-off command execution, used by snippets' run-on-hosts), `known_hosts.rs` (TOFU host-key pinning).
- `vault/` — `kdf.rs` (Argon2id), `crypto.rs` (AES-256-GCM field-level encrypt/decrypt), `store.rs` (vault create/unlock, resolves the SQLite db path).
- `state.rs` — `AppState`: holds the `Mutex<Connection>`, the in-memory `Mutex<Option<VaultKey>>`, and `DashMap`s of live SSH/SFTP/tunnel sessions keyed by UUID.
- `error.rs` — single `AppError` enum (`thiserror`) shared by every command; serializes to a plain string for the frontend.

New commands must be registered in **two** places in `lib.rs`: the `use commands::...` import list and the `tauri::generate_handler![...]` macro call — easy to forget the second one.

### Data model
`Group` (nested via `parent_id`) → `Host` (references `Identity`, optional `jump_host_id` pointing at another `Host` for ProxyJump chaining) → `Identity` (username + auth method, references `SshKey`) → `SshKey`. Plus standalone `Snippet`.

Only secrets are encrypted at the field level (identity passwords, private keys, key passphrases) via AES-256-GCM; everything else (labels, hostnames, ports, notes) is plaintext in SQLite for fast querying. `host_csv.rs` exports/imports this data model as CSV — it deliberately excludes all secret material, matching identities on the importing side by username/label rather than re-creating credentials.

### Vault / "master password"
There is **no user-facing master password** — `App.tsx` auto-unlocks the vault on launch using a fixed constant (`src/lib/constants.ts`, `VAULT_AUTO_UNLOCK_PASSWORD`) passed to the existing `vault_create`/`vault_unlock` commands. The Argon2id/AES-256-GCM machinery in `vault/` is unchanged and still fully exercised by its tests — only the frontend no longer prompts for a password or offers a lock action. The SQLite file lives at `dirs::data_dir()/sshtool/vault.db` (hardcoded literal `"sshtool"` in `vault/store.rs::db_path`, independent of the Tauri app identifier/product name — renaming the app in `tauri.conf.json` does not move or affect this path).

### Frontend (`src/`)
- `lib/tauri-bridge/` — one file per domain, each just wrapping `invoke("command_name", { args })`; `types.ts` holds the shared TS interfaces mirroring the Rust models. Always add new bridge functions here rather than calling `invoke` from components.
- `state/*Store.ts` — zustand stores. Mutations generally `await` the backend call then re-fetch the full collection (`loadAll()`) rather than patching state in place, since collections are small and this sidesteps subtle bugs from `ON DELETE SET NULL` cascades.
- `pages/AppShell.tsx` — the main layout/router-equivalent: owns `mainView` (which manage-tab or which open session tab is active) and `modal` (which create/edit form is open) as local state; every panel/form is a controlled child.
- `components/terminal/TerminalView.tsx` + `components/sftp/SftpBrowser.tsx` — one instance per open session tab, kept mounted (via CSS `visibility`, not `display:none`/unmount) while switching tabs so the SSH connection and xterm.js scrollback survive. `display:none` was tried first and silently drops the most recent scrollback line in WebKitGTK — don't reintroduce it.
- `components/sidebar/HostTree.tsx` — double-click a host row to connect (only if it has an identity); right-click opens a small custom context menu (Connect/Duplicate/Edit/Delete) built with a `useEffect` closing it on any outside click/contextmenu/keydown.
- Native file dialogs use `@tauri-apps/plugin-dialog` (`open`/`save`); reading/writing the chosen path goes through `local_read_text_file`/`local_write_text_file` Tauri commands rather than the `fs` plugin, matching the existing `local_fs_commands.rs` pattern.

### Known WebKitGTK quirks (Linux)
- Native `<select>` elements render using the OS GTK theme rather than the page's CSS and can end up with unreadable (e.g. white-on-white) text when the app's theme diverges from the system theme. Fixed via the `.themed-select` CSS class (`App.css`) + `appearance: none` with a hand-drawn arrow — reuse this class for any new `<select>`, don't rely on native styling.
- `color-scheme` must be set explicitly (`App.tsx`'s theme effect) for native form controls to follow the app's manual light/dark override instead of the OS preference.
