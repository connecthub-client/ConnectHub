# Roadmap

This reflects current thinking, not a committed schedule — priorities shift based on user feedback and contributor availability. Have an opinion? Open a [feature request](.github/ISSUE_TEMPLATE/feature_request.yml) or join the discussion in [Issues](https://github.com/connecthub-client/ConnectHub/issues).

## Post-1.0.0 priorities

- **Code signing & notarization** — signed Windows builds and notarized macOS builds, so installers stop triggering SmartScreen/Gatekeeper warnings.
- **Cross-platform CI matrix** — build and smoke-test Linux/Windows/macOS on every PR, and produce release artifacts for all three automatically on tag.
- **Windows/macOS VPN support** — the current VPN profile feature (openvpn + polkit privilege helper) is Linux-only; an equivalent privileged-helper approach is needed for Windows and macOS.
- **SSH agent authentication** — selectable as an identity's auth method today, but connecting with one currently fails outright; needs real agent-forwarding support.
- **Jump-host / ProxyJump chaining** — a host's jump host is fully modeled and configurable, but not yet consulted when actually connecting.
- **Split-pane terminals** — multiple panes within one session tab.
- **Known-hosts management UI** — view/remove pinned host-key fingerprints from Settings instead of only trust-on-first-use at connect time.
- **Frontend automated test suite** — component/store tests to complement `tsc --noEmit`; the Rust backend has unit tests plus an in-process test-SSH-server suite for session/sftp/tunnel(local)/exec.
- **Hermetic coverage for remote and dynamic/SOCKS5 port forwarding** — the new in-process test server covers local forwarding; remote forwarding and dynamic/SOCKS5 still only have manual `--ignored` coverage against a real sshd.
- **Vault auto-lock timeout** — an optional idle timeout, for anyone who wants more friction than the current always-auto-unlock model.
- **Inline, per-field form validation** — every form shows one error message at the bottom rather than next to the specific field that needs attention; required fields are now at least visually marked.

## Explicitly out of scope for now

- Mobile targets (iOS/Android) — this is a desktop tool; Tauri's mobile support isn't part of the current architecture.
- A hosted/cloud sync backend beyond the existing optional Google Drive backup.

## Recently shipped (pre-1.0.0)

See [CHANGELOG.md](CHANGELOG.md) for the full history — highlights include the encrypted local vault with no master password, multi-session SSH/SFTP/tunnels, per-host VPN profiles with automatic multi-VPN routing, Google Drive backup with cancellable sign-in, inline SSH key import, drag-to-reorder session tabs, terminal scrollback search/clickable links/OSC 52 clipboard support, host tree search, and an accessible dialog system replacing native `confirm()`/`prompt()`.
