# ConnectHub v1.0.0

> Draft content for the GitHub Release page. Copy this into the release description when tagging `v1.0.0` and publishing on [GitHub Releases](https://github.com/connecthub-client/ConnectHub/releases/new) — this file itself is not consumed automatically. Once published, delete this file (its content lives on in `CHANGELOG.md` and the release page itself) and update the checksums section below with real values before publishing.

## Release title

```
ConnectHub v1.0.0 — Initial Public Release
```

## Release description

ConnectHub is a modern, cross-platform SSH client built with Tauri, Rust, and React — an SSH terminal, SFTP browser, port forwarding/tunneling, per-host VPN, and workspace management, backed by a local encrypted vault with no master password to remember.

This is the first public release. It's been used as a daily driver during development, but this is a **1.0.0**, not a battle-tested-across-thousands-of-users release — see [Known Issues](#known-issues) below, and please [report anything you hit](https://github.com/connecthub-client/ConnectHub/issues/new?template=bug_report.yml).

### Highlights

- 🖥️ **Multi-tab SSH terminal** with trust-on-first-use host-key pinning and drag-to-reorder tabs
- 📁 **Dual-pane SFTP browser** for upload/download/rename/delete
- 🔀 **Port forwarding** — local, remote, and dynamic (SOCKS5) tunnels
- 🔒 **Per-host VPN profiles** — upload an OpenVPN config once, and ConnectHub brings the right VPN up automatically before connecting; multiple unrelated VPN profiles can be active at the same time
- 🔑 **Flexible SSH auth** — password, private key (generate, import, or paste), or SSH agent
- 🗂️ **Snippets** — save a command once, run it across one or many hosts
- ☁️ **Optional Google Drive backup** — back up/restore your encrypted vault to your own Drive, sign-in cancellable mid-flow
- 🛡️ **Encrypted local vault** — Argon2id + AES-256-GCM, field-level encryption, no master password prompt
- 🎨 Dark-first, teal-accented UI with light/dark/system theme and per-session terminal customization

See [CHANGELOG.md](CHANGELOG.md#100--2026-07-18) for the complete list.

### Known Issues

- Windows and macOS builds are produced by Tauri's bundler but have not had the same depth of manual testing as Linux — please file an issue for platform-specific bugs.
- Windows and macOS builds are **not code-signed/notarized** yet: expect a SmartScreen warning on Windows and a Gatekeeper block on first launch on macOS (see [INSTALL.md](INSTALL.md) for the one-time workaround on each).
- VPN profile support requires `openvpn` and is **Linux-only** for now.
- No automated release pipeline yet — each platform's installer is built manually for this release.

### Upgrade notes

This is the first release — there is no prior version to upgrade from. For future releases, routine upgrades (installing a newer build over an older one) preserve your existing vault; version-specific upgrade notes, if any are ever needed, will be listed here and in `CHANGELOG.md`.

### Installation

See [INSTALL.md](INSTALL.md) for full per-platform instructions, or the quick version in [README.md](README.md#installation).

### Checksums

<!-- Fill in with the real output of `sha256sum` (Linux/macOS) or `CertUtil -hashfile <file> SHA256` (Windows) against each built artifact before publishing. -->

```
SHA256SUMS (placeholder — replace before publishing)
<sha256>  ConnectHub_1.0.0_amd64.AppImage
<sha256>  ConnectHub_1.0.0_amd64.deb
<sha256>  ConnectHub-1.0.0-1.x86_64.rpm
<sha256>  ConnectHub_1.0.0_x64-setup.exe
<sha256>  ConnectHub_1.0.0_x64_en-US.msi
<sha256>  ConnectHub_1.0.0_x64.dmg
<sha256>  ConnectHub_1.0.0_aarch64.dmg
```
