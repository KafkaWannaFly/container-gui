# Container GUI Agent Guide

## Scope and Entry Points

- This is one Windows-focused Tauri 2 desktop app: React 19/Vite frontend in `src/` and Rust/Docker backend in `src-tauri/`; it is not a workspace.
- The frontend starts at `src/main.tsx`; `src/App.tsx` provides Ant Design, React Query, and hash routes. App-wide Docker event invalidation is installed by `src/layouts/MainLayout.tsx` via `useDockerEvents`.
- Rust application setup, shared state, plugins, and the complete Tauri command registration live in `src-tauri/src/lib.rs`; keep `src-tauri/src/main.rs` as the thin launcher.
- Put Docker-facing command handlers in `src-tauri/src/commands/` and business logic in `src-tauri/src/services/` or `src-tauri/src/docker/`.

## Commands

- Install both dependency sets with `make i` (`pnpm install` and `cargo fetch` run in parallel).
- Run the desktop app with `make dev`; it uses `src-tauri/tauri.dev.conf.json`, the dev icons/title, and Vite port `1420` (`strictPort`).
- Use `make test` for the repository test target: it runs `pnpm build` (the frontend type check/build) and `cargo test --manifest-path src-tauri/Cargo.toml --lib` in parallel.
- Focused checks: `pnpm build`, `pnpm lint`, `cargo test --manifest-path src-tauri/Cargo.toml --lib <test-filter>`, and `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`.
- Run `make lint` before completing cross-stack work; it runs Biome plus Clippy with warnings treated as errors. Format both sides with `make fm`.
- Use `make up`, `make profiles`, `make orphan`, and `make down` only for Docker-backed manual testing. The fixture is the fixed-name `container-gui` Compose project in `test-data/compose.yaml`; `make down` removes its volumes and the `cgui-edge` network.

## Frontend and IPC Contract

- Use `src/services/tauriApi.ts` as the frontend boundary to Rust. Add/update its Zod schema validation and typed wrapper when changing a command; do not invoke commands ad hoc from pages.
- For a new Tauri command, add the handler under `src-tauri/src/commands/`, export its module from `commands/mod.rs`, and register it in `tauri::generate_handler![]` in `lib.rs`. Keep frontend argument names camelCase; Tauri maps them to Rust snake_case parameters.
- Streaming commands use Tauri `Channel` objects and must have cancellation/lifecycle handling; the shared `openStream` wrapper cancels with `stop_stream` using a unique stream ID.
- Keep React Query cache keys centralized in `src/lib/queryClient.ts`; extend `useDockerEvents` when Docker changes must invalidate newly cached data.

## Data, Configuration, and Release Gotchas

- SQLx: one pool, one database file (`app-data/app.db`), one migrator. The pool is opened in `src-tauri/src/lib.rs` setup via `crate::db`; repositories (`MetricsDb`, `VolumeSizeCache`) are built there and receive a clone of the pool. Repositories must not open their own pool. Migrations are in `src-tauri/migrations/` and are embedded at compile time; `src-tauri/build.rs` must watch that directory.
- The app opens persistent SQLite data under the Tauri app-data directory and falls back to in-memory databases if that directory cannot be used. Do not assume cache/history persistence in tests or runtime error paths.
- `src-tauri/capabilities/default.json` is the permission source of truth. Add capability permissions when adding a Tauri plugin/API that needs them.
- `make pub-win` builds the NSIS installer and signs updater artifacts. It expects `TAURI_SIGNING_PRIVATE_KEY` or `~/.tauri/container-gui.key`; never replace or generate the release signing key casually, because installed versions require the same key for updates.

## Formatting

- Biome only includes `src/**`, `vite.config.ts`, and TypeScript configs. It uses two spaces, LF, double quotes, semicolons, trailing commas, and a 110-column line width; Rust uses rustfmt's four spaces.
- The repository-local `opencode.json` provides the Ant Design MCP server. Use it for current Ant Design component/API work.
