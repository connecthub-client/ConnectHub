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

## Release artifact naming

Tauri's bundler names outputs `<productName>_<version>_<arch>.<ext>` (Linux/macOS) or `<productName>_<version>_<arch>-setup.exe` / `_<arch>_en-US.msi` (Windows), e.g. `ConnectHub_1.0.0_amd64.AppImage`. The exact filename for each release is always listed on its [GitHub Releases](https://github.com/connecthub-client/ConnectHub/releases) page — treat this document's examples as a pattern, not a guarantee.
