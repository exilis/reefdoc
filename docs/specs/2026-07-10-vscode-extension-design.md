# reefdoc VS Code / Cursor Extension — Design

**Date:** 2026-07-10
**Status:** Design approved; not yet implemented.

## Summary

An editor extension that brings reefdoc's existing preview UI *inside* VS Code
and Cursor, so you no longer switch to a separate browser tab. The extension is
a thin **launcher + embedder**: it spawns the bundled `reefdoc` binary pointed
at the workspace folder, then displays that running server's localhost UI in a
VS Code webview panel. The Go backend and vanilla-JS frontend are reused
verbatim — no reimplementation of rendering, watching, or live reload.

Cursor is a VS Code fork, so a single extension covers both editors.

## Goals

- Show the full reefdoc app (file tree, tabs, TOC, live reload, change
  highlighting) in an editor tab instead of a browser tab.
- Reuse the existing binary and frontend with zero changes to rendering logic.
- One command to open the preview; single-instance per window.
- Bundle per-platform binaries so users need no separate install.
- Work identically in VS Code and Cursor.

## Non-goals (YAGNI)

- **Marketplace publishing.** Distribution is out of scope; the build produces a
  local `.vsix` installed via "Install from VSIX." This is for in-editor use,
  not public distribution.
- **Active-editor sync / scroll-sync / click-to-source.** The panel shows
  reefdoc's own navigation (its file tree + tabs), not the currently focused
  editor file. Deeper editor integration is a possible future project, not this
  one.
- **Remote / Codespaces support.** Targets local desktop use. `asExternalUri`
  port-forwarding is noted as a future hook but not implemented.
- **Reimplementing the frontend against VS Code APIs.** Explicitly rejected — it
  throws away the whole point of bundling the binary.

## Binary flag: already present

The binary already accepts `--addr` (`main.go:23`, default `127.0.0.1:8080`),
so the extension can direct it to any port with no change to `main.go`. The
extension selects a free port itself (bind an ephemeral socket, read the port,
release it, pass it as `--addr 127.0.0.1:<port>`) rather than relying on the
server to report a `:0`-assigned port.

## Architecture & components

The extension lives in `editor/vscode/` inside this repo — versioned alongside
the binary, sharing the release cross-compile that produces per-platform
binaries.

- **`extension.ts` — activation & command.** Registers one command,
  `reefdoc.openPreview` ("reefdoc: Open Preview"). On invoke: resolve the
  workspace root, pick a free localhost port, start the server, then open the
  webview panel. Holds the single-instance reference to the live panel.
- **`server.ts` — binary lifecycle.** Resolves the correct bundled binary for
  the current `process.platform` / `process.arch`, spawns
  `reefdoc --addr 127.0.0.1:<port> <workspaceRoot>`, polls `GET /` until the
  port answers (with a timeout), and exposes `stop()` to kill the child
  process. One server process per panel.
- **`panel.ts` — the webview.** Creates a `WebviewPanel` titled "reefdoc" with a
  reefdoc icon. Its HTML is a full-bleed `<iframe src="http://127.0.0.1:<port>">`
  plus a CSP `<meta>` that permits framing that localhost origin. Owns cleanup:
  on panel dispose, call `server.stop()`.
- **`bin/` — bundled binaries.** Per-platform subdirectories
  (`darwin-arm64/`, `darwin-x64/`, `linux-x64/`, `win32-x64/`, …) populated by a
  build step from reefdoc's existing release cross-compile.

The Go source and frontend are untouched — the extension only consumes the
compiled binary over HTTP.

## Data flow & lifecycle

1. User runs **reefdoc: Open Preview** (command palette or title-bar button).
2. Extension picks a free port `P`, spawns
   `reefdoc --addr 127.0.0.1:P <workspaceRoot>`, polls until `P` responds.
3. Extension opens the "reefdoc" webview panel; the iframe loads
   `http://127.0.0.1:P`. From here it is the normal reefdoc app — file tree,
   tabs, SSE live reload — served by that process, inside the editor tab.
4. Re-running the command reveals the existing panel instead of spawning a
   second server (single-instance per window).
5. Closing the panel disposes it → the binary is killed. Closing the window or
   deactivating the extension kills any surviving child process.

## Packaging & configuration

- **Binaries.** An npm `build` script copies reefdoc's cross-compiled release
  binaries into `bin/<platform>-<arch>/`. The `.vsix` ships all of them (a few
  MB each — acceptable). `.vscodeignore` keeps source `.ts` out of the package.
- **Config settings** (contributed under `reefdoc.*`):
  - `reefdoc.binaryPath` — override the bundled binary with a custom build.
  - `reefdoc.host` — listen host, default `127.0.0.1`.

  Deliberately minimal; nothing else until a real need appears.
- **Install.** Build produces a `.vsix` installed locally via "Install from
  VSIX." No marketplace entry.

## Error handling

All failures surface as VS Code notifications:

- No bundled binary for this platform/arch → "unsupported platform: …".
- Binary fails to start or the port never opens → show the last stderr line.
- No workspace folder open → "Open a folder to preview".

## Testing

- **Unit tests:** platform → binary-path resolution; free-port selection.
- **Smoke test:** spawn the real bundled binary on an ephemeral port and assert
  `GET /` returns 200 — mirrors the existing Go/Playwright philosophy of driving
  the real binary.
- **Manual verification checklist** for the webview (open panel → tree renders →
  live reload fires on a file edit → close panel → child process gone). Driving
  VS Code's webview in CI is heavy and out of scope for this iteration.

## Alternatives considered

- **Simple Browser command** (`simpleBrowser.show(url)`): ultra-minimal (~30
  lines, no webview HTML) but gives generic browser chrome, a "Simple Browser"
  tab title, and little lifecycle control. Rejected in favor of a proper panel;
  kept in mind as a fast fallback if the custom panel proves troublesome.
- **Auto-download binary on first run** / **assume binary on PATH**: rejected in
  favor of bundling, which gives users zero-setup and keeps the binary version
  locked to the extension version.
- **Port the frontend into a native webview** (drop the Go binary, reimplement
  the file API/watcher against VS Code APIs): a large rewrite that discards the
  reuse this design is built on. Rejected.
