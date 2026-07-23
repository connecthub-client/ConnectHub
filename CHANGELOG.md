# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- A "Connecting to `<host>` (`<hostname>:<port>`)…" overlay with a spinner now covers the terminal pane while a session is connecting, instead of the previously blank/black pane with only a small status-bar label - reported as easy to mistake for the app having frozen.

### Fixed

- Install docs (README.md/INSTALL.md) hardcoded a version number (`1.0.0`) in `.../releases/latest/download/<filename>` URLs - that permalink only resolves if the exact filename exists in whatever release is *currently* tagged latest, so every copy-pasted command 404'd as soon as 1.1.0 shipped (reported by a user hitting this exact 404). Commands now resolve the current release's actual asset URL via the GitHub API instead, so they keep working release after release.
- Documented that the installed **package** name (`connect-hub`, shown by `apt`/`dnf`) differs from the installed **binary** name (`connecthub`, no hyphen) - launching from a terminal after a `.deb`/`.rpm` install needs the latter, which isn't obvious from the install output (reported alongside the URL issue above).
- A host added to (or assigned) a VPN profile *after* that profile's VPN was already connected never got its own explicit `/32` route - `add_host_routes` only ran once, on the VPN's own CONNECTED transition, snapshotting whichever hosts referenced the profile at that exact moment. Reported as two hosts sharing one VPN profile + SSH identity, where only the host present when the VPN first connected was ever reachable through the app, while both connected fine manually (outside the app) with the same VPN/credentials. `ensure_host_route` now adds a host's route on demand whenever `ensureVpnUp` finds its profile already connected, so a host added later gets routed without needing the VPN disconnected and reconnected.

## [1.1.0] — 2026-07-22

### Added

- **VSCode-style layout**: an icon Activity Bar (Hosts/Identities/Keys/VPN, plus Google Backup/Settings pinned to the bottom) replacing the old top tab bar, a Primary Side Bar, and a Snippets panel accessible from a dedicated icon on the right edge. Both side panels have independent collapse toggles (pinned chevrons, top of the Activity Bar and above the Snippets icon) that stay reachable in either state.
- The center "Hosts" view now shows every host as a grid - click to select, double-click to connect - so hosts stay reachable even with the sidebar collapsed.
- Host favorites, a "Recent" list, and a preset icon picker (generic icons, major cloud-provider marks, and A-Z colored monograms behind a "More" toggle) in the host tree.
- Per-host live Performance panel (CPU/RAM/swap/disk/network), shown while connected, with its own show/hide toggle. Host Details (address/port/user/VPN profile/session status/key/last connected) is its own card with an independent show/hide toggle and now stays visible regardless of connection state; the Connect button disables itself once a session is already open.
- Quick Commands "Most used": ranks the last 100 executed commands by frequency. Prefers the server's own `~/.zsh_history`/`~/.bash_history` (re-fetched on every connect), falling back to commands recorded locally - either clicked here or typed directly in the terminal.
- Quick Commands "Auto-Run" toggle: ON sends a clicked command straight into the live terminal session followed by Enter; OFF inserts it for manual review/edit/submit instead. Falls back to the previous one-off exec-and-show-result behavior when no terminal session is open for that host.
- Visual refresh: self-hosted Inter font, a richer dark background (renamed the base gray scale from neutral to slate), larger corner radius and subtle shadows on buttons/cards, and a consistent teal accent color on every checkbox/radio/range input (previously left at the OS default).

### Removed

- **Jump-host / ProxyJump chaining** — was modeled but never actually consulted when connecting; removed the `jump_host_id` field, its CSV column, and its UI entirely rather than keep unused, half-built plumbing around.
- **Port forwarding / Tunnels** (local, remote, and dynamic/SOCKS5) — removed the whole feature (`ssh/tunnel.rs`, the Tunnels tab, tunnel forms/store).
- The host panel's "Edit host" shortcut and its per-host "Recent" run-history list - editing remains available via the host tree's right-click menu; "Recent" is superseded by the new frequency-ranked "Most used".

### Changed

- Hosts CSV export/import no longer has a `jump_host_label` column — re-importing a CSV exported before this change may fail; re-export first.

### Fixed

- The Auto-Run toggle's thumb rendered off-center in both positions (a missing base offset, not a functional bug - the setting itself always worked) - now sits flush against either edge like a normal switch.

## [1.0.0] — 2026-07-18

Initial public release.

### Added

- **Host manager** — nested groups, hosts, reusable identities (password, private key, or SSH agent auth), jump-host (ProxyJump) chaining, double-click-to-connect and a right-click Connect/Duplicate/Edit/Delete menu.
- **SSH terminal** — multi-tab, multi-session, xterm.js-powered, with trust-on-first-use (TOFU) host-key verification and pinning.
- **SFTP browser** — dual-pane local/remote file transfer with upload/download, mkdir, rename, delete.
- **Port forwarding** — local, remote, and dynamic (SOCKS5) tunnels from one panel.
- **VPN profiles** — per-host OpenVPN profiles that connect automatically before a session/SFTP/tunnel and disconnect automatically once unused; multiple unrelated VPN profiles can be connected at the same time via automatic per-host route injection.
- **Snippets** — save commands once, run them across one or many hosts, with per-host aggregated output, including one-click "Quick Commands" from a host's own panel.
- **SSH key management** — generate new Ed25519/RSA keys, or import existing ones (OpenSSH or legacy PEM/PKCS#1), including inline import while creating a host.
- **CSV import/export** for the host list (metadata only — never secrets).
- **Google Drive backup** *(optional)* — OAuth2 PKCE sign-in with your own Google account, backing up the full encrypted vault to a private, hidden Drive `appDataFolder`, with cancellable sign-in.
- **Encrypted vault** — Argon2id + AES-256-GCM field-level encryption for secrets, with no user-facing master password (auto-unlock via a per-installation secret).
- **Settings** — light/dark/system theme (dark by default), terminal font/size/cursor/color theme with live updates, and keyboard shortcuts (see [README.md](README.md#keyboard-shortcuts)).
- **Drag-to-reorder session tabs.**

### Changed

- Project renamed **SSH Tool → Termora → ConnectHub** over the course of development; a small number of internal, non-user-facing identifiers (vault data directory, Google Drive backup filenames, VPN polkit helper paths) intentionally retain earlier internal names to avoid orphaning existing installs/backups — see [ARCHITECTURE.md](ARCHITECTURE.md) for details.

### Fixed

- Connecting to a second host on a different VPN profile while a first VPN was already connected no longer fails — each host now gets an explicit route through its own profile's tunnel.
- Double-click and right-click "Connect" on a host now correctly bring up that host's VPN profile first, matching the button in the host's own panel (previously only the panel's own button did this).

### Security

- VPN helper scripts run under narrowly-scoped polkit rules and force `--script-security 0`, so an uploaded `.ovpn` config can never execute arbitrary code as root.
- Vault key derivation and the per-installation auto-unlock secret were hardened during development; see [ARCHITECTURE.md](ARCHITECTURE.md#vault--master-password) for the current design and its tradeoffs.

[Unreleased]: https://github.com/connecthub-client/ConnectHub/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/connecthub-client/ConnectHub/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/connecthub-client/ConnectHub/releases/tag/v1.0.0
