# reefdoc VS Code / Cursor Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a VS Code / Cursor extension that opens reefdoc's existing preview UI inside an editor panel by spawning the bundled `reefdoc` binary and framing its localhost server.

**Architecture:** The extension is a thin launcher + embedder living in `editor/vscode/`. `server.ts` (pure Node, no `vscode` import) resolves the bundled per-platform binary, picks a free port, spawns `reefdoc --addr 127.0.0.1:<port> <workspaceRoot>`, and polls until it's ready. `panel.ts` opens a webview panel whose body is a full-bleed iframe pointing at that server. `extension.ts` wires a single command with single-instance behaviour and disposes the server when the panel closes. The Go backend and JS frontend are reused verbatim.

**Tech Stack:** TypeScript, VS Code Extension API (`vscode` engine ^1.85.0), Node.js built-ins (`net`, `http`, `child_process`), `tsc` for build, `tsx` + `node --test` for unit tests, `@vscode/vsce` for packaging.

## Global Constraints

- Extension source lives under `editor/vscode/`; it is its own npm project (separate `package.json` from the repo root).
- Editor engine floor: `"vscode": "^1.85.0"`. Same extension targets both VS Code and Cursor (Cursor is a VS Code fork) — no Cursor-specific code.
- The binary already accepts `--addr` (`main.go:23`, default `127.0.0.1:8080`) — **do not modify `main.go`**. Direct the server with `--addr 127.0.0.1:<port>`.
- `server.ts` MUST NOT import `vscode`, so it stays unit-testable under plain Node. Only `panel.ts` and `extension.ts` import `vscode`.
- Bundle per-platform binaries under `editor/vscode/bin/<platform>-<arch>/reefdoc[.exe]`. Do not publish to a marketplace; the deliverable is a locally-installable `.vsix`.
- Config keys are exactly `reefdoc.binaryPath` (string, default `""`) and `reefdoc.host` (string, default `127.0.0.1`). The single command id is exactly `reefdoc.openPreview`, titled `reefdoc: Open Preview`.
- Commit style: conventional-commit prefixes (`feat:`, `test:`, `chore:`, `docs:`).

---

### Task 1: Extension scaffold that activates and registers the command

**Files:**
- Create: `editor/vscode/package.json`
- Create: `editor/vscode/tsconfig.json`
- Create: `editor/vscode/.gitignore`
- Create: `editor/vscode/src/extension.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `activate(context: vscode.ExtensionContext): void` and `deactivate(): void` exported from `src/extension.ts`. Command id `reefdoc.openPreview` registered.

- [ ] **Step 1: Create `editor/vscode/package.json`**

```json
{
  "name": "reefdoc",
  "displayName": "reefdoc",
  "description": "Preview markdown, mermaid & allium in an editor panel via the reefdoc binary.",
  "version": "0.1.0",
  "publisher": "exilis",
  "private": true,
  "license": "MIT",
  "engines": { "vscode": "^1.85.0" },
  "categories": ["Other"],
  "main": "./out/extension.js",
  "contributes": {
    "commands": [
      { "command": "reefdoc.openPreview", "title": "reefdoc: Open Preview" }
    ],
    "configuration": {
      "title": "reefdoc",
      "properties": {
        "reefdoc.binaryPath": {
          "type": "string",
          "default": "",
          "description": "Absolute path to a reefdoc binary to use instead of the bundled one."
        },
        "reefdoc.host": {
          "type": "string",
          "default": "127.0.0.1",
          "description": "Host the reefdoc server listens on."
        }
      }
    }
  },
  "scripts": {
    "build": "tsc -p ./",
    "watch": "tsc -watch -p ./",
    "test": "tsx --test src/**/*.test.ts"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "@types/vscode": "^1.85.0",
    "tsx": "^4.19.0",
    "typescript": "^5.4.0",
    "@vscode/vsce": "^2.24.0"
  }
}
```

- [ ] **Step 2: Create `editor/vscode/tsconfig.json`**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "outDir": "out",
    "rootDir": "src",
    "lib": ["ES2022"],
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

- [ ] **Step 3: Create `editor/vscode/.gitignore`**

```
node_modules/
out/
*.vsix
```

- [ ] **Step 4: Create `editor/vscode/src/extension.ts` (minimal activatable stub)**

```ts
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand('reefdoc.openPreview', () => {
    vscode.window.showInformationMessage('reefdoc: Open Preview (stub)');
  });
  context.subscriptions.push(disposable);
}

export function deactivate(): void {
  // no-op until later tasks
}
```

- [ ] **Step 5: Install deps and verify the project compiles**

Run: `cd editor/vscode && npm install && npm run build`
Expected: `npm install` succeeds; `tsc` produces `out/extension.js` with no errors.

- [ ] **Step 6: Commit**

```bash
git add editor/vscode/package.json editor/vscode/tsconfig.json editor/vscode/.gitignore editor/vscode/src/extension.ts
git commit -m "feat: scaffold reefdoc VS Code extension with stub command"
```

---

### Task 2: Pure server helpers — binary path resolution and free-port selection

**Files:**
- Create: `editor/vscode/src/server.ts`
- Test: `editor/vscode/src/server.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `resolveBinaryPath(extensionPath: string, platform?: NodeJS.Platform, arch?: string): string` — returns `<extensionPath>/bin/<platform>-<arch>/reefdoc` (`.exe` on `win32`). Throws `Error` with message `unsupported platform: <platform>-<arch>` for an unsupported pair.
  - `findFreePort(): Promise<number>` — resolves an OS-assigned free TCP port on `127.0.0.1`.

- [ ] **Step 1: Write the failing tests**

Create `editor/vscode/src/server.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBinaryPath, findFreePort } from './server.ts';

test('resolveBinaryPath builds a per-platform path', () => {
  assert.equal(
    resolveBinaryPath('/ext', 'darwin', 'arm64'),
    '/ext/bin/darwin-arm64/reefdoc',
  );
  assert.equal(
    resolveBinaryPath('/ext', 'linux', 'x64'),
    '/ext/bin/linux-x64/reefdoc',
  );
});

test('resolveBinaryPath adds .exe on windows', () => {
  assert.equal(
    resolveBinaryPath('/ext', 'win32', 'x64'),
    '/ext/bin/win32-x64/reefdoc.exe',
  );
});

test('resolveBinaryPath rejects unsupported platform/arch', () => {
  assert.throws(
    () => resolveBinaryPath('/ext', 'sunos', 'mips'),
    /unsupported platform: sunos-mips/,
  );
});

test('findFreePort returns a usable port number', async () => {
  const port = await findFreePort();
  assert.ok(Number.isInteger(port));
  assert.ok(port > 0 && port < 65536);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd editor/vscode && npm test`
Expected: FAIL — `Cannot find module './server.ts'` (file not created yet).

- [ ] **Step 3: Write minimal implementation**

Create `editor/vscode/src/server.ts`:

```ts
import * as net from 'node:net';
import * as path from 'node:path';

const SUPPORTED = new Set([
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'win32-x64',
]);

export function resolveBinaryPath(
  extensionPath: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  const key = `${platform}-${arch}`;
  if (!SUPPORTED.has(key)) {
    throw new Error(`unsupported platform: ${key}`);
  }
  const exe = platform === 'win32' ? 'reefdoc.exe' : 'reefdoc';
  return path.join(extensionPath, 'bin', key, exe);
}

export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error('could not determine free port')));
      }
    });
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd editor/vscode && npm test`
Expected: PASS — all four tests green.

- [ ] **Step 5: Commit**

```bash
git add editor/vscode/src/server.ts editor/vscode/src/server.test.ts
git commit -m "feat: add binary-path resolution and free-port selection"
```

---

### Task 3: Server lifecycle — spawn the binary, wait for ready, stop

**Files:**
- Modify: `editor/vscode/src/server.ts`
- Test: `editor/vscode/src/server.smoke.test.ts`

**Interfaces:**
- Consumes: `resolveBinaryPath`, `findFreePort` from Task 2.
- Produces:
  - `interface ReefdocServer { port: number; host: string; url: string; stop(): void }`
  - `startServer(opts: { binaryPath: string; root: string; host: string; port: number; timeoutMs?: number }): Promise<ReefdocServer>` — spawns `binaryPath --addr <host>:<port> <root>`, polls `GET <url>` until it returns any HTTP response or `timeoutMs` (default 10000) elapses, then resolves. Rejects (and kills the child) on timeout or spawn error. `stop()` kills the child process.

- [ ] **Step 1: Write the failing smoke test**

Create `editor/vscode/src/server.smoke.test.ts`:

```ts
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import * as http from 'node:http';
import { findFreePort, startServer, ReefdocServer } from './server.ts';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
let binaryPath: string;
let docRoot: string;
let srv: ReefdocServer | undefined;

before(() => {
  const outDir = mkdtempSync(path.join(tmpdir(), 'reefdoc-bin-'));
  binaryPath = path.join(outDir, 'reefdoc');
  // Build the real binary from repo root (requires Go on PATH).
  execFileSync('go', ['build', '-o', binaryPath, '.'], { cwd: repoRoot });
  docRoot = mkdtempSync(path.join(tmpdir(), 'reefdoc-docs-'));
  writeFileSync(path.join(docRoot, 'README.md'), '# hello\n');
});

after(() => {
  srv?.stop();
});

test('startServer spawns the binary and serves over HTTP', async () => {
  const port = await findFreePort();
  srv = await startServer({ binaryPath, root: docRoot, host: '127.0.0.1', port });
  assert.equal(srv.port, port);

  const status: number = await new Promise((resolve, reject) => {
    http.get(srv!.url, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    }).on('error', reject);
  });
  assert.equal(status, 200);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd editor/vscode && npm test`
Expected: FAIL — `startServer` / `ReefdocServer` are not exported from `./server.ts`.

- [ ] **Step 3: Add the implementation to `editor/vscode/src/server.ts`**

Append these imports and code to `editor/vscode/src/server.ts`:

```ts
import { spawn, ChildProcess } from 'node:child_process';
import * as http from 'node:http';

export interface ReefdocServer {
  port: number;
  host: string;
  url: string;
  stop(): void;
}

function probe(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startServer(opts: {
  binaryPath: string;
  root: string;
  host: string;
  port: number;
  timeoutMs?: number;
}): Promise<ReefdocServer> {
  const { binaryPath, root, host, port } = opts;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const url = `http://${host}:${port}`;

  const child: ChildProcess = spawn(
    binaryPath,
    ['--addr', `${host}:${port}`, root],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );

  let stderrTail = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-500);
  });

  let exited = false;
  child.on('exit', () => {
    exited = true;
  });

  const stop = () => {
    if (!child.killed) {
      child.kill();
    }
  };

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exited) {
      stop();
      throw new Error(`reefdoc exited before serving: ${stderrTail.trim()}`);
    }
    if (await probe(url)) {
      return { port, host, url, stop };
    }
    await delay(150);
  }
  stop();
  throw new Error(`reefdoc did not become ready within ${timeoutMs}ms`);
}
```

Note: `Date.now()` / `setTimeout` are ordinary Node APIs here (this is extension runtime code, not a workflow script) and are fine to use.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd editor/vscode && npm test`
Expected: PASS — the smoke test builds the real binary, spawns it, and gets HTTP 200. (Requires Go on PATH, matching the repo's e2e requirement.)

- [ ] **Step 5: Commit**

```bash
git add editor/vscode/src/server.ts editor/vscode/src/server.smoke.test.ts
git commit -m "feat: spawn reefdoc binary and wait until it serves"
```

---

### Task 4: Webview panel that frames the running server

**Files:**
- Create: `editor/vscode/src/panel.ts`

**Interfaces:**
- Consumes: nothing from prior tasks directly (receives a URL string).
- Produces: `createReefdocPanel(url: string): vscode.WebviewPanel` — creates and returns a webview panel titled `reefdoc` whose body is a full-viewport iframe loading `url`, with a CSP permitting the localhost frame.

This task imports `vscode`, so it is verified manually (Step 3) rather than by a Node unit test.

- [ ] **Step 1: Create `editor/vscode/src/panel.ts`**

```ts
import * as vscode from 'vscode';

function webviewHtml(url: string): string {
  const csp = [
    "default-src 'none'",
    'frame-src http://127.0.0.1:* http://localhost:*',
    "style-src 'unsafe-inline'",
  ].join('; ');
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<style>
  html, body { margin: 0; padding: 0; height: 100%; width: 100%; overflow: hidden; }
  iframe { border: 0; width: 100%; height: 100%; display: block; }
</style>
</head>
<body>
  <iframe src="${url}" title="reefdoc preview"></iframe>
</body>
</html>`;
}

export function createReefdocPanel(url: string): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel(
    'reefdoc.preview',
    'reefdoc',
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  panel.webview.html = webviewHtml(url);
  return panel;
}
```

- [ ] **Step 2: Compile to catch type errors**

Run: `cd editor/vscode && npm run build`
Expected: `tsc` succeeds, `out/panel.js` produced.

- [ ] **Step 3: Manual verification (deferred until Task 5 wires it)**

`createReefdocPanel` has no standalone UI trigger yet — it is exercised by the command wired in Task 5. No separate manual step here; verification happens in Task 5, Step 4.

- [ ] **Step 4: Commit**

```bash
git add editor/vscode/src/panel.ts
git commit -m "feat: webview panel that frames the reefdoc server"
```

---

### Task 5: Wire the command — single instance, spawn, frame, cleanup, errors

**Files:**
- Modify: `editor/vscode/src/extension.ts`

**Interfaces:**
- Consumes: `resolveBinaryPath`, `findFreePort`, `startServer`, `ReefdocServer` from `server.ts`; `createReefdocPanel` from `panel.ts`.
- Produces: fully-wired `reefdoc.openPreview` command; `activate`/`deactivate` manage a single live `{ panel, server }`.

This task imports `vscode`; verify manually via the Extension Development Host (Step 4).

- [ ] **Step 1: Replace `editor/vscode/src/extension.ts` with the wired implementation**

```ts
import * as vscode from 'vscode';
import {
  resolveBinaryPath,
  findFreePort,
  startServer,
  ReefdocServer,
} from './server';
import { createReefdocPanel } from './panel';

interface Live {
  panel: vscode.WebviewPanel;
  server: ReefdocServer;
}

let current: Live | undefined;

async function openPreview(context: vscode.ExtensionContext): Promise<void> {
  if (current) {
    current.panel.reveal(vscode.ViewColumn.Beside);
    return;
  }

  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showErrorMessage('reefdoc: Open a folder to preview.');
    return;
  }
  const root = folder.uri.fsPath;

  const cfg = vscode.workspace.getConfiguration('reefdoc');
  const host = cfg.get<string>('host', '127.0.0.1');
  const overridePath = cfg.get<string>('binaryPath', '');

  let binaryPath: string;
  try {
    binaryPath = overridePath || resolveBinaryPath(context.extensionPath);
  } catch (err) {
    vscode.window.showErrorMessage(`reefdoc: ${(err as Error).message}`);
    return;
  }

  let server: ReefdocServer;
  try {
    const port = await findFreePort();
    server = await startServer({ binaryPath, root, host, port });
  } catch (err) {
    vscode.window.showErrorMessage(`reefdoc: failed to start — ${(err as Error).message}`);
    return;
  }

  const panel = createReefdocPanel(server.url);
  current = { panel, server };
  panel.onDidDispose(() => {
    server.stop();
    current = undefined;
  });
}

export function activate(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand('reefdoc.openPreview', () =>
    openPreview(context),
  );
  context.subscriptions.push(disposable);
}

export function deactivate(): void {
  current?.server.stop();
  current = undefined;
}
```

- [ ] **Step 2: Compile**

Run: `cd editor/vscode && npm run build`
Expected: `tsc` succeeds with no errors.

- [ ] **Step 3: Run the full unit/smoke test suite**

Run: `cd editor/vscode && npm test`
Expected: PASS — Task 2 and Task 3 tests still green (extension.ts is not unit-tested but must not break the build the test loader shares).

- [ ] **Step 4: Manual verification in the Extension Development Host**

Because the extension has no bundled binary yet (Task 6), temporarily set `reefdoc.binaryPath` to the repo-root binary for this check:
1. Build the binary: `go build -o "$PWD/reefdoc" .` from the repo root.
2. Open `editor/vscode/` in VS Code, press F5 to launch the Extension Development Host.
3. In the dev-host window, open a folder that contains markdown, set `reefdoc.binaryPath` to the absolute path of the binary from step 1.
4. Run **reefdoc: Open Preview** from the command palette. Confirm: a panel titled "reefdoc" opens beside the editor, the file tree renders, opening a doc works, editing a file on disk live-reloads the panel.
5. Close the panel; confirm the `reefdoc` process is gone (`pgrep reefdoc` returns nothing). Re-run the command; confirm only one panel/process exists.

Record the result of step 4–5 in the commit message body.

- [ ] **Step 5: Commit**

```bash
git add editor/vscode/src/extension.ts
git commit -m "feat: wire reefdoc.openPreview command with lifecycle and errors"
```

---

### Task 6: Bundle per-platform binaries and package the .vsix

**Files:**
- Create: `editor/vscode/scripts/bundle-binaries.mjs`
- Create: `editor/vscode/.vscodeignore`
- Create: `editor/vscode/README.md`
- Modify: `editor/vscode/package.json` (add `bundle` and `package` scripts)
- Modify: `editor/vscode/.gitignore` (ignore `bin/`)

**Interfaces:**
- Consumes: the platform keys used by `resolveBinaryPath` (`darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`, `win32-x64`).
- Produces: `bin/<platform>-<arch>/reefdoc[.exe]` for each key, and a `reefdoc-0.1.0.vsix` from `npm run package`.

- [ ] **Step 1: Create the cross-compile script `editor/vscode/scripts/bundle-binaries.mjs`**

```js
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import * as path from 'node:path';

// Maps our bin/<key> directories to Go GOOS/GOARCH values.
const TARGETS = [
  { key: 'darwin-arm64', goos: 'darwin', goarch: 'arm64' },
  { key: 'darwin-x64', goos: 'darwin', goarch: 'amd64' },
  { key: 'linux-arm64', goos: 'linux', goarch: 'arm64' },
  { key: 'linux-x64', goos: 'linux', goarch: 'amd64' },
  { key: 'win32-x64', goos: 'windows', goarch: 'amd64' },
];

const extDir = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(extDir, '..', '..');
const binRoot = path.join(extDir, 'bin');

rmSync(binRoot, { recursive: true, force: true });

for (const t of TARGETS) {
  const outDir = path.join(binRoot, t.key);
  mkdirSync(outDir, { recursive: true });
  const exe = t.goos === 'windows' ? 'reefdoc.exe' : 'reefdoc';
  const outFile = path.join(outDir, exe);
  console.log(`building ${t.key} -> ${outFile}`);
  execFileSync('go', ['build', '-o', outFile, '.'], {
    cwd: repoRoot,
    env: { ...process.env, GOOS: t.goos, GOARCH: t.goarch, CGO_ENABLED: '0' },
    stdio: 'inherit',
  });
}
console.log('done');
```

- [ ] **Step 2: Create `editor/vscode/.vscodeignore`**

```
src/**
scripts/**
tsconfig.json
**/*.test.ts
**/*.map
.gitignore
node_modules/**
```

Note: `out/**` and `bin/**` are intentionally NOT ignored — they must ship in the `.vsix`.

- [ ] **Step 3: Create `editor/vscode/README.md`**

```markdown
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
```

- [ ] **Step 4: Add `bundle` and `package` scripts to `editor/vscode/package.json`**

In the `"scripts"` block, add:

```json
    "bundle": "node scripts/bundle-binaries.mjs",
    "package": "npm run bundle && npm run build && vsce package --no-dependencies"
```

- [ ] **Step 5: Ignore the generated `bin/` directory in `editor/vscode/.gitignore`**

Append to `editor/vscode/.gitignore`:

```
bin/
```

- [ ] **Step 6: Run the bundle and package end-to-end**

Run: `cd editor/vscode && npm install && npm run package`
Expected: `bin/<key>/reefdoc[.exe]` created for all five targets; `tsc` compiles; `vsce package` emits `reefdoc-0.1.0.vsix`. (Requires Go on PATH for cross-compilation.)

- [ ] **Step 7: Verify the packaged extension installs and runs**

1. In VS Code: Extensions view → "…" menu → "Install from VSIX…" → select `reefdoc-0.1.0.vsix`.
2. Open a folder with markdown, run **reefdoc: Open Preview** with NO `reefdoc.binaryPath` set (so the bundled binary is used).
3. Confirm the panel opens and renders, and closing it stops the process.

- [ ] **Step 8: Commit**

```bash
git add editor/vscode/scripts/bundle-binaries.mjs editor/vscode/.vscodeignore editor/vscode/README.md editor/vscode/package.json editor/vscode/.gitignore
git commit -m "chore: bundle per-platform binaries and package the extension"
```

---

## Self-Review

**Spec coverage:**
- In-editor preview via bundled binary → Tasks 3–6. ✓
- Single command `reefdoc.openPreview` → Task 1 (contribution) + Task 5 (behaviour). ✓
- `server.ts` free of `vscode`, unit-testable → Tasks 2–3. ✓
- Single-instance per window; kill child on panel close / deactivate → Task 5. ✓
- Per-platform binary resolution + bundling → Task 2 (`resolveBinaryPath`) + Task 6 (bundle script). ✓
- Config `reefdoc.binaryPath` / `reefdoc.host` → Task 1 (contribution) + Task 5 (consumption). ✓
- Error notifications (no binary for platform, start failure, no workspace) → Task 5. ✓
- `--addr` already present, `main.go` untouched → Global Constraints; used in Task 3. ✓
- Smoke test drives the real binary → Task 3. ✓
- No marketplace; local `.vsix` → Task 6. ✓
- Cursor + VS Code from one extension → Global Constraints (no editor-specific code). ✓

**Placeholder scan:** No TBD/TODO; every code and command step is concrete.

**Type consistency:** `resolveBinaryPath`, `findFreePort`, `startServer`, `ReefdocServer`, `createReefdocPanel` names/signatures match across Tasks 2–5. Platform keys in `SUPPORTED` (Task 2) match `TARGETS` keys in the bundle script (Task 6): `darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`, `win32-x64`. ✓
