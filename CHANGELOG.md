# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

Nothing yet.

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

[Unreleased]: https://github.com/connecthub-client/ConnectHub/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/connecthub-client/ConnectHub/releases/tag/v1.0.0
