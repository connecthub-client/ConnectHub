# Termora

A desktop SSH client built with Tauri, React, and Rust — host manager, terminal, SFTP, port forwarding, and snippets, backed by an encrypted local vault. Inspired by tools like Termius, built from scratch.

## Screenshots

| Host manager | Terminal |
| --- | --- |
| ![Host manager](docs/screenshots/hosts.png) | ![Terminal](docs/screenshots/terminal.png) |

| SFTP browser | Port forwarding |
| --- | --- |
| ![SFTP browser](docs/screenshots/sftp.png) | ![Tunnels](docs/screenshots/tunnels.png) |

| Snippets | Settings |
| --- | --- |
| ![Snippets](docs/screenshots/snippets.png) | ![Settings](docs/screenshots/settings.png) |

| Dark mode |
| --- |
| ![Dark mode](docs/screenshots/dark-mode.png) |

## Features

- **Host manager** — nested groups, hosts, reusable identities (password/key/agent auth), jump-host (ProxyJump) chaining
  - Double-click a host to connect instantly; right-click for a Connect/Duplicate/Edit/Delete menu
  - Import/export your host list as CSV (host/group/identity-reference metadata only — never secrets) for backup or bulk editing
- **SSH terminal** — multi-tab, multi-session, xterm.js-powered, TOFU host-key verification and pinning
- **SFTP browser** — dual-pane local/remote file transfer with upload/download, mkdir, rename, delete
- **Port forwarding** — local, remote, and dynamic (SOCKS5) tunnels, managed from one panel
- **Snippets** — save commands once, run them across one or many hosts, with per-host aggregated output
- **Import/export SSH keys** — generate new keys, or import existing ones (OpenSSH or legacy PEM/PKCS#1 format) by pasting or browsing to a file
- **Settings** — light/dark/system theme, terminal font/size/cursor/color theme (with live updates to open sessions), keybindings
- **Encrypted vault** — Argon2id + AES-256-GCM field-level encryption; only secrets (passwords, private keys, passphrases) are encrypted, everything else stays plaintext for fast querying

## Tech stack

- **Backend:** Rust, Tauri 2, [`russh`](https://github.com/Eugeny/russh) (pure-Rust async SSH), `russh-sftp`, `fast-socks5`, `rusqlite`
- **Frontend:** React + TypeScript + Vite + Tailwind CSS v4, xterm.js, zustand

## Getting started

### Prerequisites

- Node.js 18+ and npm
- Rust toolchain (via [rustup](https://rustup.rs))
- Tauri's platform dependencies — see the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/) for your OS

### Development

```bash
npm install
npm run tauri dev
```

### Build

```bash
npm run tauri build
```

## Testing

The Rust backend has both fast unit tests and live integration tests that exercise real SSH/SFTP/tunnel flows against a local `sshd`:

```bash
cd src-tauri
cargo test --lib                       # unit tests
cargo test --lib -- --ignored          # live tests (requires a reachable local sshd)
```

## Security notes

- The vault never stores plaintext secrets on disk — only Argon2id-derived-key-encrypted ciphertext for passwords, private keys, and passphrases.
- Host key verification follows trust-on-first-use (TOFU): the first connection to a host pins its fingerprint, and any later mismatch is rejected rather than silently accepted.
- There is no master-password prompt — the app unlocks its local vault automatically on launch using a fixed built-in key (see `src/lib/constants.ts`), trading at-rest secrecy for convenience on a personal/single-user machine. This means anyone with access to your user account can decrypt the vault; it is **not** a substitute for OS-level disk encryption or account security if that's a concern for your setup.
- CSV export/import never includes passwords or private keys — only enough identity metadata (label + username) to match against credentials that already exist on the importing machine.
