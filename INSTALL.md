# Installing ConnectHub

This covers installing a pre-built release for end users. To build from source instead, see [BUILD.md](BUILD.md).

All releases are published on [GitHub Releases](https://github.com/connecthub-client/ConnectHub/releases/latest). Exact filenames are shown on each release page; the examples below use the `1.0.0` naming pattern.

## Linux

**Option A — AppImage (no install, no root):**

```bash
curl -fsSL -o ConnectHub.AppImage https://github.com/connecthub-client/ConnectHub/releases/latest/download/ConnectHub_1.0.0_amd64.AppImage \
  && chmod +x ConnectHub.AppImage \
  && ./ConnectHub.AppImage
```

Move it somewhere on your `$PATH` (e.g. `~/.local/bin/`) if you want to launch it by name later.

**Option B — Debian/Ubuntu `.deb`:**

```bash
curl -fsSL -o connecthub.deb https://github.com/connecthub-client/ConnectHub/releases/latest/download/ConnectHub_1.0.0_amd64.deb \
  && sudo apt install ./connecthub.deb
```

**Option C — Fedora/RHEL `.rpm`:**

```bash
curl -fsSL -o connecthub.rpm https://github.com/connecthub-client/ConnectHub/releases/latest/download/ConnectHub-1.0.0-1.x86_64.rpm \
  && sudo dnf install ./connecthub.rpm
```

**Uninstall:** `sudo apt remove connecthub` / `sudo dnf remove connecthub`, or simply delete the AppImage. Your vault data is left in place (see [Data location](#data-location)) unless you remove it separately.

**VPN feature:** if you plan to use per-host VPN profiles, install the `openvpn` package (`sudo apt install openvpn` / `sudo dnf install openvpn`) — the app will prompt for a one-time privileged setup step the first time you use the VPN tab.

## Windows

1. Download the installer from the [latest release](https://github.com/connecthub-client/ConnectHub/releases/latest) — `ConnectHub_1.0.0_x64-setup.exe` (NSIS) or `ConnectHub_1.0.0_x64_en-US.msi` (WiX).
2. Run it. Builds are not yet code-signed, so **SmartScreen** may show "Windows protected your PC" — click **More info → Run anyway**.
3. Launch ConnectHub from the Start Menu.

**Uninstall:** Settings → Apps → ConnectHub → Uninstall.

VPN profile support is Linux-only for now; the VPN tab is hidden/inactive on Windows.

## macOS

1. Download `ConnectHub_1.0.0_x64.dmg` (Intel) or `ConnectHub_1.0.0_aarch64.dmg` (Apple Silicon) from the [latest release](https://github.com/connecthub-client/ConnectHub/releases/latest).
2. Open the `.dmg` and drag **ConnectHub** into **Applications**.
3. The app is not yet notarized, so Gatekeeper will block the first launch ("ConnectHub can't be opened because Apple cannot check it for malicious software"). Either:
   - Right-click (or Control-click) the app in Applications → **Open** → **Open** again in the dialog, or
   - Run: `xattr -cr /Applications/ConnectHub.app`

**Uninstall:** drag `ConnectHub.app` from Applications to the Trash.

VPN profile support is Linux-only for now.

## Data location

ConnectHub stores its encrypted vault (hosts, identities, keys, snippets, VPN profiles) locally in a SQLite database under your OS's application data directory, plus a small per-installation secret file used to auto-unlock it. Neither is created anywhere inside a source checkout. See [ARCHITECTURE.md](ARCHITECTURE.md#vault--master-password) for the full explanation of why there's no master password to remember.

## Upgrading

Installing a newer release over an older one (via any of the methods above) preserves your existing vault — there is no separate migration step for routine updates. See a given release's notes on [GitHub Releases](https://github.com/connecthub-client/ConnectHub/releases) for any version-specific upgrade notes.

## Troubleshooting

- **Linux: AppImage won't run ("permission denied")** — you likely skipped `chmod +x`; re-run the one-liner above.
- **Linux: AppImage fails with a FUSE error** — some minimal/container environments lack FUSE; extract and run it instead: `./ConnectHub.AppImage --appimage-extract && ./squashfs-root/AppRun`.
- **Windows/macOS: security warning on first launch** — expected for now; see the [code signing status](BUILD.md#code-signing-status) note. If you'd rather build from a source you trust yourself, see [BUILD.md](BUILD.md).
- **VPN tab shows a setup prompt every time** — setup didn't complete (the `pkexec` prompt was cancelled, or a package like `polkit` is missing). Re-run it from the VPN tab.

Still stuck? See [SUPPORT.md](SUPPORT.md).
