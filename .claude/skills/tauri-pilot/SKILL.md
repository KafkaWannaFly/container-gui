---
name: tauri-pilot
description: Inspect, drive, and verify the running Container GUI Tauri app through the tauri-pilot plugin — accessibility snapshots with refs, real clicks/typing, assertions, screenshots, console/network logs, and direct Tauri IPC calls against real Docker data. Use when a task needs to see what the app actually renders, verify a UI change end-to-end, reproduce a bug in the real window, or exercise a Tauri command the way a user would. Triggers on "see the app UI", "verify in the app", "screenshot the app", "snapshot the app", "tauri-pilot", "drive the app", "click in the app", "check the app renders", "make dev" + UI verification.
---

# tauri-pilot

The Vite page on `http://localhost:1420` has **no Tauri IPC** — every `invoke()` fails and it
shows "Docker Daemon Not Reachable". Never verify data, layout, or behaviour there. Use
tauri-pilot against the real WebView2 window, which sees real Docker data.

## Already wired in this repo

- `src-tauri/Cargo.toml`: `tauri-plugin-pilot = "0.7"`
- `src-tauri/src/lib.rs`: `.plugin(tauri_plugin_pilot::init())` behind `#[cfg(debug_assertions)]`
  — so it is **never compiled into release builds**
- `src-tauri/capabilities/default.json`: `"pilot:default"` permission (without it, `eval`
  times out after 10s)
- CLI: `cargo install tauri-pilot-cli`

## Workflow

```bash
make dev                 # start the app; the plugin serves a named pipe
tauri-pilot ping         # health check — do this first
```

Then the agent loop:

```bash
tauri-pilot snapshot -i              # accessibility tree, interactive elements only, with @eN refs
tauri-pilot click @e3
tauri-pilot fill @e2 "workspace"
tauri-pilot assert text @e1 "Dashboard"   # exit 0 = pass, exit 1 = fail
tauri-pilot diff -i                  # only what changed since the last snapshot
tauri-pilot logs --level error       # JS errors
```

Use refs from `snapshot`, not hand-written CSS selectors — they survive markup changes and
avoid class-name churn (antd renamed `.ant-tooltip-inner` to `.ant-tooltip-container[role=tooltip]`
between v5 and v6, which silently broke a CSS-based check).

`--json` on any command gives structured output. `snapshot --save` persists one for `diff`.

## Useful commands

| Need | Command |
| --- | --- |
| See the UI | `snapshot`, `screenshot out.png` (then read the PNG) |
| Read state | `text`, `value`, `attrs`, `state`, `url`, `title`, `forms` |
| Act | `click`, `fill`, `type`, `press`, `select`, `check`, `scroll`, `drag`, `drop` |
| Wait | `wait --selector ".success-message"`, `wait --text "..."` |
| Verify | `assert text|visible|hidden|value|count|checked|contains|url ...` |
| Arbitrary JS | `eval "document.title"`, `eval -` with a quoted heredoc for multi-line |
| Real Tauri command | `ipc <command>` — bypasses the UI to test backend behaviour |
| Console / network | `logs --level error`, `network` |
| Multi-window | `windows`, then `--window <name>` |
| Regressions | `record start` / `record stop --output t.json` / `replay t.json` (`--export sh`) |
| Scripted run | `run scenario.toml --junit report.xml` |
| MCP | `tauri-pilot mcp` (stdio) exposes all of the above as `pilot.*` tools |

Global flags go before the subcommand: `tauri-pilot --window main snapshot -i`.

## Gotchas

- Pre-1.0 — minor versions may break the CLI/plugin pair. Keep the crate and CLI versions
  in step; if `ping` fails after an upgrade, check both.
- The plugin must be in the running build: it only exists with `cargo` debug builds
  (`make dev`), never in a release binary.
- `screenshot` captures the WebView content only — no native window chrome, menus, or
  system dialogs. For those, use OS-level automation instead.
- Windows transport is a named pipe; the CLI cannot reach an app running inside WSL.
- When done, stop the app tree: `taskkill /PID <make-pid> /T /F`.
