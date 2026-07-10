# reefdoc for VS Code / Cursor

Opens the [reefdoc](https://github.com/exilis/reefdoc) markdown / mermaid /
allium preview inside an editor panel. Bundles the reefdoc binary — no separate
install needed.

## Usage

Open a folder, then run **reefdoc: Open Preview** from the command palette. A
panel opens beside your editor showing reefdoc's file tree, tabs, and live
reload. Close the panel to stop the server.

## Settings

- `reefdoc.binaryPath` — use a custom binary instead of the bundled one.
- `reefdoc.host` — listen host (default `127.0.0.1`).

## Build & package

```bash
npm install
npm run bundle    # cross-compiles binaries into bin/ (needs Go on PATH)
npm run build     # compiles TypeScript into out/
npm run package   # produces reefdoc-<version>.vsix
```

Install the `.vsix` via the Extensions view → "Install from VSIX…".
