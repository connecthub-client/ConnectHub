# Installing ConnectHub

This covers installing a pre-built release for end users. To build from source instead, see [BUILD.md](BUILD.md).

All releases are published on [GitHub Releases](https://github.com/connecthub-client/ConnectHub/releases/latest). Asset filenames are versioned (e.g. `ConnectHub_1.1.0_amd64.AppImage`), so **don't hardcode a version number in a download URL** — `.../releases/latest/download/<exact-filename>` only works if that exact filename exists in whatever release is *currently* tagged latest, which breaks the moment a new version ships. The commands below instead ask the GitHub API for the actual current asset URL first, so they keep working release after release without editing.

> Currently ships Linux artifacts only. Windows and macOS are supported by the codebase but haven't been built/published yet — see the Windows/macOS sections below for the current workaround (build from source).

## Linux

**Option A — AppImage (no install, no root):**

```bash
curl -fsSL $(curl -fsSL https://api.github.com/repos/connecthub-client/ConnectHub/releases/latest \
    | grep -oP '"browser_download_url":\s*"\K[^"]+\.AppImage') -o ConnectHub.AppImage \
  && chmod +x ConnectHub.AppImage \
  && ./ConnectHub.AppImage
```

Move it somewhere on your `$PATH` (e.g. `~/.local/bin/`) if you want to launch it by name later.

**Option B — Debian/Ubuntu `.deb`:**

```bash
curl -fsSL $(curl -fsSL https://api.github.com/repos/connecthub-client/ConnectHub/releases/latest \
    | grep -oP '"browser_download_url":\s*"\K[^"]+\.deb') -o connecthub.deb \
  && sudo apt install ./connecthub.deb
```

**Option C — Fedora/RHEL `.rpm`:**

```bash
curl -fsSL $(curl -fsSL https://api.github.com/repos/connecthub-client/ConnectHub/releases/latest \
    | grep -oP '"browser_download_url":\s*"\K[^"]+\.rpm') -o connecthub.rpm \
  && sudo dnf install ./connecthub.rpm
```

**Launching after a `.deb`/`.rpm` install:** search for **ConnectHub** in your desktop's application menu — that's the intended path and always works. From a terminal, the command is `connecthub` (all lowercase, **no hyphen** — this differs from the installed *package* name, which both apt and dnf show as `connect-hub`; typing the package name as a command, as it's reasonable to try, won't work). Don't launch it with `sudo` — it's a regular desktop app and doesn't need (or want) root.

**Uninstall:** `sudo apt remove connect-hub` / `sudo dnf remove connect-hub` (the package name is hyphenated even though the command isn't — see above), or simply delete the AppImage. Your vault data is left in place (see [Data location](#data-location)) unless you remove it separately.

**VPN feature:** if you plan to use per-host VPN profiles, install the `openvpn` package (`sudo apt install openvpn` / `sudo dnf install openvpn`) — the app will prompt for a one-time privileged setup step the first time you use the VPN tab.

## Windows

**No pre-built installer yet** — every release so far has been built and published from a Linux machine, and Tauri's bundler doesn't cross-compile a Windows installer from Linux. Build it yourself instead: see [BUILD.md](BUILD.md#prerequisites) for the Windows prerequisites, then `npm run tauri build` on a Windows machine produces `ConnectHub_<version>_x64-setup.exe` (NSIS) or `ConnectHub_<version>_x64_en-US.msi` (WiX) under `src-tauri/target/release/bundle/`.

Once a Windows build is published to [Releases](https://github.com/connecthub-client/ConnectHub/releases/latest), installing it will be: download → run → click **More info → Run anyway** if SmartScreen warns (builds aren't code-signed yet) → launch from the Start Menu. Uninstall via Settings → Apps → ConnectHub.

VPN profile support is Linux-only for now; the VPN tab is hidden/inactive on Windows.

## macOS

**No pre-built installer yet**, for the same reason as Windows above. Build it yourself: see [BUILD.md](BUILD.md#prerequisites) for the macOS prerequisites, then `npm run tauri build` on a Mac produces a `.dmg` under `src-tauri/target/release/bundle/dmg/`.

Once a macOS build is published to [Releases](https://github.com/connecthub-client/ConnectHub/releases/latest), installing it will be: download the `.dmg` → drag **ConnectHub** into **Applications** → since it won't be notarized yet, Gatekeeper will block the first launch — right-click the app → **Open** → **Open** again in the dialog, or run `xattr -cr /Applications/ConnectHub.app`. Uninstall by dragging the app to the Trash.

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
- **`connect-hub: command not found` / `./connect-hub: command not found`** — the installed *binary* is named `connecthub` (no hyphen), not `connect-hub` (that's the *package* name apt/dnf show, which isn't a runnable command). Run `connecthub`, or just launch **ConnectHub** from your application menu instead — see [Launching after a .deb/.rpm install](#linux) above.
- **`.deb` install prints `N: Download is performed unsandboxed as root as file '...' couldn't be accessed by user '_apt'. - pkgAcquire::Run (13: Permission denied)`** — this looks alarming but is an apt **notice** (`N:`), not an error: apt normally reads a local `.deb` as the unprivileged `_apt` user first, and falls back to reading it as root when it can't (typically because your `$HOME` has restrictive permissions, e.g. `chmod 700`, blocking `_apt`'s traversal into it). If the lines after it say `Setting up connect-hub (<version>) ...` and the trigger-processing steps complete with no further errors, the install succeeded — check with `dpkg -l connect-hub` or just launch it. This is a property of `apt install ./local-file.deb` in general, not specific to ConnectHub's package; if you'd rather avoid it entirely, use the AppImage instead (Option A above), which doesn't go through apt/dpkg at all.

Still stuck? See [SUPPORT.md](SUPPORT.md).
