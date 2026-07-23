# Building ConnectHub from source

This covers producing a production bundle for your own machine. For day-to-day development (hot reload, debug builds), see [DEVELOPMENT.md](DEVELOPMENT.md).

## Prerequisites

- **Node.js 18+** and npm
- **Rust** (stable toolchain) via [rustup](https://rustup.rs)
- **Tauri's platform dependencies** — see the official [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/) for your OS. In short:

  - **Linux:** `libwebkit2gtk-4.1-dev`, `libjavascriptcoregtk-4.1-dev`, `libssl-dev`, `libgtk-3-dev`, `librsvg2-dev`, `libayatana-appindicator3-dev`, `pkg-config`, `build-essential`
  - **Windows:** Microsoft C++ Build Tools (via Visual Studio Installer) and WebView2 (preinstalled on modern Windows 10/11)
  - **macOS:** Xcode Command Line Tools (`xcode-select --install`)

## Build

```bash
git clone https://github.com/connecthub-client/ConnectHub.git
cd ConnectHub
npm install
npm run tauri build
```

This runs the frontend build (`tsc && vite build`) and then Tauri's bundler for your current OS/architecture. Bundled installers are written to `src-tauri/target/release/bundle/`:

| Platform | Output |
| --- | --- |
| Linux | `bundle/appimage/*.AppImage`, `bundle/deb/*.deb`, `bundle/rpm/*.rpm` |
| Windows | `bundle/msi/*.msi`, `bundle/nsis/*-setup.exe` |
| macOS | `bundle/dmg/*.dmg`, `bundle/macos/*.app` |

`src-tauri/tauri.conf.json` sets `"bundle.targets": "all"`, so the bundler produces every format available for the host platform in one run — there is no cross-compilation from a single host to all three OSes; each platform's installers must be built on that platform (or via per-OS CI runners).

## Frontend-only build

If you only need to verify the frontend compiles (no native bundle):

```bash
npm run build     # tsc && vite build, output in dist/
```

## Verifying a build

```bash
cd src-tauri
cargo check
cargo test --lib
cargo clippy --lib --no-default-features
cd ..
npx tsc --noEmit
```

## Code signing status

Builds produced by `npm run tauri build` today are **unsigned**:

- **macOS:** not code-signed or notarized. Gatekeeper will block launching a locally built or downloaded `.app`/`.dmg` — bypass with right-click → **Open**, or `xattr -cr` the extracted app.
- **Windows:** not code-signed. SmartScreen will warn on first run.
- **Linux:** AppImages/`.deb`/`.rpm` are not signed by a distro-recognized key; no OS-level gate blocks running them.

Setting up code signing/notarization for official releases is tracked in [ROADMAP.md](ROADMAP.md).

This is separate from **updater signing** below, which is unrelated to OS code-signing/notarization - it's how the in-app updater verifies a downloaded update actually came from this project before installing it.

## Auto-update signing

Settings → About's "Check for updates" uses Tauri's official updater plugin, which needs every release build signed with this project's updater keypair so the app can verify a downloaded update before installing it - **this is separate from and unrelated to the OS code-signing above**. The public half lives in `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`, safe to commit). The private half is **not** in this repo and must never be committed - only whoever cuts releases holds it, and losing it means no future release can be verified by apps that already trust the current pubkey (the only recovery is shipping a new pubkey, which itself only reaches users once *they've* manually installed that release, since older auto-updaters won't trust it).

To produce a signed release build, set these before running `npm run tauri build` (see `tauri signer generate` to create a keypair, if you don't already have one - `tauri signer generate --help` for options, including an optional password):

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat /path/to/your/private.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""   # or your key's password, if it has one
npm run tauri build
```

With `bundle.createUpdaterArtifacts: true` (set in `tauri.conf.json`) and those env vars present, `tauri build` additionally signs each Linux bundle in place and writes a `.sig` file right next to it - `ConnectHub_<version>_amd64.deb.sig`, `ConnectHub-<version>-1.x86_64.rpm.sig`, and `ConnectHub_<version>_amd64.AppImage.sig` (confirmed against a real signed build - no `.tar.gz` wrapping happens, unlike some older Tauri versions/docs). Without the env vars set, the build still succeeds and produces the normal installers, just without these `.sig` files - fine for a personal build, but a real release needs them (see the Release workflow's `latest.json` step in [CLAUDE.md](CLAUDE.md#auto-update)). Only the **AppImage**'s signature actually matters for the updater manifest below - the `.deb`/`.rpm` ones are an unused-but-harmless byproduct of Tauri signing every bundle it produces, since only the AppImage can actually be silently replaced in place (see the "Linux is AppImage-only" note in [CLAUDE.md](CLAUDE.md#auto-update)).

A real release also needs a `latest.json` manifest uploaded as its own release asset, since that's the one file the updater's `endpoints` URL actually points at:

```json
{
  "version": "1.1.2",
  "notes": "See the CHANGELOG",
  "pub_date": "2026-07-24T00:00:00Z",
  "platforms": {
    "linux-x86_64": {
      "signature": "<contents of the ConnectHub_1.1.2_amd64.AppImage.sig file, verbatim>",
      "url": "https://github.com/connecthub-client/ConnectHub/releases/download/v1.1.2/ConnectHub_1.1.2_amd64.AppImage"
    }
  }
}
```

Only Windows/macOS builds would add `windows-x86_64`/`darwin-x86_64` (etc.) entries the same way, once this project actually ships those platforms' bundles (see the "no cross-compilation" note above) - there's no `linux-x86_64` fallback for them.

## Release artifact naming

Tauri's bundler names outputs `<productName>_<version>_<arch>.<ext>` (Linux/macOS) or `<productName>_<version>_<arch>-setup.exe` / `_<arch>_en-US.msi` (Windows), e.g. `ConnectHub_1.1.0_amd64.AppImage`. The exact filename for each release is always listed on its [GitHub Releases](https://github.com/connecthub-client/ConnectHub/releases) page — treat this document's examples as a pattern, not a guarantee. Never hardcode a version number in a `.../releases/latest/download/<filename>` URL in docs/scripts — that permalink only resolves if the exact filename exists in whatever release is *currently* tagged latest, so a hardcoded version breaks on every subsequent release (see [INSTALL.md](INSTALL.md#linux) for the version-resolving pattern used instead).

The **installed package name is not the installed binary name**: the `.deb`/`.rpm` bundler kebab-cases `productName` for the package itself (`connect-hub`, confirmed via `dpkg-deb -c`/`strings` on the built artifacts), but the actual executable Tauri installs to `/usr/bin/` and references from the `.desktop` file's `Exec=` line uses the Cargo package name from `src-tauri/Cargo.toml` (`connecthub`, one word, no hyphen). `apt`/`dnf remove` need the package name (`connect-hub`); running it from a terminal needs the binary name (`connecthub`) — typing one where the other belongs is a real, reported point of confusion (see [INSTALL.md](INSTALL.md#linux)), not a packaging bug to fix, just something to keep in sync if either name ever changes.
