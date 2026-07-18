# Development guide

This covers day-to-day development. For a from-source production build, see [BUILD.md](BUILD.md). For architecture background, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Prerequisites

- Node.js 18+ and npm
- Rust toolchain (via [rustup](https://rustup.rs))
- Tauri's platform dependencies — see [BUILD.md](BUILD.md#prerequisites)

## Running the dev server

```bash
npm install
npm run tauri dev
```

This launches Vite (frontend, hot-reloading) and the Tauri window together. Editing Rust code under `src-tauri/` triggers an automatic rebuild and app restart; editing frontend code under `src/` hot-reloads without a restart.

## Project layout

```
src-tauri/src/
  commands/   #[tauri::command] wrappers — thin, delegate to data/
  data/       CRUD + domain logic against SQLite, one module per entity
  models/     plain structs (Host, Identity, SshKey, ...) + *Input variants
  ssh/        session/SFTP/tunnel/exec via russh, russh-sftp, fast-socks5
  vault/      Argon2id KDF + AES-256-GCM field-level encryption
  vpn/        openvpn process management + privileged helper setup
  google/     OAuth2 PKCE + Drive backup
  state.rs    AppState (db connection, vault key, live session maps)
  error.rs    shared AppError enum

src/
  pages/       AppShell.tsx (main layout/router-equivalent)
  components/  terminal/ sidebar/ sftp/ panels/ forms/ common/
  state/       zustand stores, one per domain
  lib/
    tauri-bridge/   typed invoke() wrappers + shared TS types — never call
                    invoke() directly from a component
```

## Coding conventions

- **Never call `invoke()` from a component.** Add a typed wrapper in `src/lib/tauri-bridge/` instead, even for a one-off command.
- **New Tauri commands must be registered in two places** in `src-tauri/src/lib.rs`: the `use commands::...` import list and the `tauri::generate_handler![...]` macro call. Forgetting the second one is a common mistake — the command compiles but the frontend gets a runtime "command not found" error.
- **Rust model fields are snake_case** and are *not* camelCased by Tauri — the frontend's TypeScript interfaces in `types.ts` must match exactly.
- **Business logic lives in `data/`, not `commands/`.** Commands should only lock state and delegate.
- **Each `data/*.rs` module owns its own tests** (`#[cfg(test)] mod tests`) against an in-memory SQLite connection — no mocking layer, no shared test fixtures module.
- **Frontend stores re-fetch after mutating** (`await backendCall(); loadAll();`) rather than patching local state in place, since collections are small and this avoids subtle bugs from cascading deletes.

## Adding a new schema column to an existing table

`CREATE TABLE IF NOT EXISTS` is a no-op against a table that already exists in a shipped database. If you need to add a column to a table that may already exist on someone's disk, add it to the fresh-schema `CREATE TABLE` **and** guard it with an `add_column_if_missing`-style migration in `data::init_schema` (see existing examples there) — don't rely on the `CREATE TABLE` alone.

## Testing

```bash
cd src-tauri
cargo test --lib                        # unit tests — fast, in-memory SQLite, no network
cargo test --lib -- --ignored           # live integration tests, see below
cargo test --lib <substring>            # run a single test or module
cargo clippy --lib --no-default-features
```

```bash
npx tsc --noEmit    # frontend type-check (no separate test runner yet)
```

### Live SSH integration tests

Tests under `*::live_sshd_tests` modules (in `ssh/session.rs`, `ssh/sftp.rs`, `ssh/tunnel.rs`, `ssh/exec.rs`) are marked `#[ignore]` and connect to a **real local `sshd` on port 22** using a dedicated throwaway SSH keypair whose public half must be appended to `~/.ssh/authorized_keys`. Generate a keypair for this purpose, point the test module's hardcoded key path at it, and add it to `authorized_keys` before running:

```bash
cargo test --lib -- --ignored
```

Never reuse or modify your real personal SSH keys for this.

## Commit and PR conventions

See [CONTRIBUTING.md](CONTRIBUTING.md) for commit message style, branch naming, and the PR checklist.
