# Security Policy

## Supported Versions

| Version | Supported |
| --- | --- |
| 1.0.x | ✅ |
| < 1.0 (pre-release) | ❌ |

Only the latest `1.x` release receives security fixes. Please upgrade to the latest release before reporting an issue.

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Instead, use GitHub's private vulnerability reporting:

1. Go to the [Security tab](https://github.com/connecthub-client/ConnectHub/security) of this repository.
2. Click **Report a vulnerability**.
3. Describe the issue, including steps to reproduce, affected version(s), and potential impact.

This opens a private advisory visible only to you and the maintainers, so a fix can be prepared before any public disclosure.

If you're unable to use GitHub's private reporting for any reason, open a regular issue asking a maintainer to reach out for a private channel — without describing the vulnerability itself in the public issue.

## What to expect

- **Acknowledgement:** we aim to acknowledge new reports within a few days.
- **Assessment:** we'll confirm whether the report is a valid vulnerability and its severity.
- **Fix & disclosure:** once a fix is ready, we'll coordinate a release and credit the reporter (unless you'd prefer to stay anonymous) in the release notes.

## Scope

This policy covers the ConnectHub application itself (`src-tauri/` and `src/` in this repository) — the vault encryption scheme, VPN privilege-escalation helpers, Google OAuth flow, SSH/SFTP/tunnel handling, and the build/release process.

It does **not** cover vulnerabilities in third-party dependencies themselves (please report those upstream — e.g. to the [russh](https://github.com/Eugeny/russh) or [Tauri](https://github.com/tauri-apps/tauri) projects directly), though we're glad to hear about ones that affect ConnectHub so we can update pinned versions.

## Notable design decisions relevant to security review

If you're auditing this project, [ARCHITECTURE.md](ARCHITECTURE.md) documents the reasoning behind several choices that might otherwise look like findings on first read:

- Why there is no user-facing master password, and what that trades away.
- Why the Google OAuth `client_secret` is committed to source (PKCE is the actual security boundary for a Desktop-app-type OAuth client).
- How the VPN privilege-escalation helpers are scoped to prevent an uploaded `.ovpn` file from running arbitrary code as root.
