# Contributing to ConnectHub

Thanks for considering a contribution! This document covers the practical parts of contributing; for the "why" behind the codebase's structure, see [ARCHITECTURE.md](ARCHITECTURE.md) and [DEVELOPMENT.md](DEVELOPMENT.md).

By participating in this project, you're expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- For a small fix (typo, obvious bug), feel free to open a PR directly.
- For anything larger (a new feature, a behavior change, a refactor), please open an issue first to discuss the approach — this avoids spending effort on something that might not fit the project's direction. See the [Roadmap](ROADMAP.md) for planned work that might already be in progress.

## Development setup

```bash
git clone https://github.com/connecthub-client/ConnectHub.git
cd ConnectHub
npm install
npm run tauri dev
```

Full setup, project layout, and coding conventions are in [DEVELOPMENT.md](DEVELOPMENT.md).

## Before opening a pull request

Run the full check suite locally:

```bash
cd src-tauri
cargo check
cargo test --lib
cargo clippy --lib --no-default-features
cd ..
npx tsc --noEmit
```

If your change affects the Rust backend, add or update tests in the relevant `data/*.rs` or `ssh/*.rs` module's own `#[cfg(test)] mod tests`. If it's user-facing, consider whether [README.md](README.md), [CHANGELOG.md](CHANGELOG.md), or [ROADMAP.md](ROADMAP.md) need updating too.

## Commit messages

This project writes commit messages as a single imperative-mood summary line, capitalized, no trailing period, describing what the commit does — for example:

```
Add per-host VPN profile support
Fix double-click Connect skipping VPN auto-connect
Route each host through its own VPN explicitly
```

Add a body (blank line, then paragraphs) if the *why* isn't obvious from the summary alone. There's no enforced prefix convention (no `feat:`/`fix:` scopes) — just a clear, specific summary.

## Pull requests

- Keep PRs focused on one change — easier to review, easier to revert if needed.
- Fill in the PR template (description, testing done, checklist).
- Link the issue it addresses, if any.
- A maintainer will review and may ask for changes before merging.

## Reporting bugs / requesting features

Use the issue templates: [Bug Report](.github/ISSUE_TEMPLATE/bug_report.yml) or [Feature Request](.github/ISSUE_TEMPLATE/feature_request.yml).

## Reporting security vulnerabilities

**Do not open a public issue.** See [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the project's [MIT License](LICENSE).
