# Browser E2E Test for Document Download — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Playwright browser E2E test that drives the real `reefdoc` binary and verifies the document-download feature end-to-end (button visibility lifecycle, click → download, filename, and saved-file content fidelity for text and binary).

**Architecture:** A self-contained Playwright spec (`web/e2e/download.e2e.js`) builds `reefdoc` with `go build`, spawns it on a runtime-selected free port against a temp fixture dir, drives a real Chromium via Playwright, and asserts user-visible outcomes including the actual downloaded bytes. A new isolated CI job `e2e` runs it; the existing fast `go`/`web` jobs are untouched.

**Tech Stack:** Playwright (`@playwright/test`, Chromium only), Node 22, Go 1.23.

**Spec:** `docs/specs/2026-06-26-download-e2e-design.md`

---

## File Structure

- `playwright.config.js` (repo root) — Playwright config: `testDir: web/e2e`, Chromium-only project, timeout, artifacts dir.
- `web/e2e/download.e2e.js` — the E2E spec: harness (build + spawn binary, free port, ready-poll, cleanup) + 5 test cases.
- `package.json` — add `@playwright/test` devDependency + `"e2e"` script.
- `.github/workflows/ci.yml` — new `e2e` job.
- `.gitignore` — Playwright artifacts (`/test-results`, `/playwright-report`).

Note on `package-lock.json`: it is gitignored in this repo, and the existing `web` CI job runs `npm install` (not `npm ci`). The new `e2e` job follows the same `npm install` pattern — do not add `npm ci` or commit a lockfile.

---

## Task 1: Playwright dependency, config, and gitignore

**Files:**
- Modify: `package.json`
- Create: `playwright.config.js`
- Modify: `.gitignore`

- [ ] **Step 1: Add the Playwright devDependency and e2e script to `package.json`**

The current file is:
```json
{
  "name": "reefdoc-web-tests",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test" },
  "devDependencies": {
    "highlight.js": "11.9.0",
    "markdown-it": "14.1.0",
    "markdown-it-task-lists": "2.1.1"
  }
}
```
Change it to (adds the `e2e` script and the `@playwright/test` devDependency; keep `test` exactly as-is so the unit job is unchanged):
```json
{
  "name": "reefdoc-web-tests",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test",
    "e2e": "playwright test"
  },
  "devDependencies": {
    "@playwright/test": "1.55.0",
    "highlight.js": "11.9.0",
    "markdown-it": "14.1.0",
    "markdown-it-task-lists": "2.1.1"
  }
}
```

- [ ] **Step 2: Install the dependency and the Chromium browser**

Run:
```bash
npm install
npx playwright install chromium
```
Expected: `@playwright/test` appears under `node_modules/`, and `npx playwright --version` prints a version. (CI uses `--with-deps`; locally `chromium` alone is fine.)

- [ ] **Step 3: Create `playwright.config.js` at the repo root**

```js
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './web/e2e',
  testMatch: '**/*.e2e.js',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 30_000,
  reporter: process.env.CI ? 'list' : 'line',
  outputDir: './test-results',
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
```

- [ ] **Step 4: Add Playwright artifacts to `.gitignore`**

Append to `.gitignore`:
```
# Playwright E2E artifacts
/test-results
/playwright-report
```

- [ ] **Step 5: Verify Playwright is wired up (no tests yet)**

Run: `npx playwright test --list`
Expected: exits cleanly reporting "Total: 0 tests in 0 files" (no spec exists yet) — confirms the config loads without error.

- [ ] **Step 6: Commit**

```bash
git add package.json playwright.config.js .gitignore
git commit -m "build(e2e): add Playwright (chromium) config and scripts"
```

---

## Task 2: E2E harness — build, spawn, free port, ready-poll, cleanup

**Files:**
- Create: `web/e2e/download.e2e.js`

This task builds only the harness (`beforeAll`/`afterAll` + a trivial smoke test that the server is reachable). Test cases come in Task 3. Writing the harness first lets us prove the build/spawn/teardown plumbing in isolation.

- [ ] **Step 1: Write the harness with one smoke test**

Create `web/e2e/download.e2e.js`:
```js
import { test, expect } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Repo root is two levels up from web/e2e/.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Known fixture content, asserted byte-for-byte after download.
const DOC_MD = '# Title\n\nHello from reefdoc E2E.\n';
// Minimal valid-enough PDF bytes (content fidelity is what we assert, not
// renderability). Includes a non-ASCII/control-ish byte to prove binary safety.
const PDF_BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34,
  0x0a, 0x00, 0xff, 0xfe, 0x80, 0x0a, 0x25, 0x25, 0x45, 0x4f, 0x46, 0x0a]);

// Pick a free TCP port by binding :0, reading the assigned port, releasing it.
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// Poll GET / until 200 or timeout.
async function waitForServer(base, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(base + '/');
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('reefdoc server did not become ready at ' + base);
}

let proc;
let tmp;
let base;

test.beforeAll(async () => {
  // Build the real binary (exercises go:embed assets and the real server).
  execFileSync('go', ['build', '-o', 'reefdoc', '.'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });

  // Seed a temp fixture dir with known files.
  tmp = mkdtempSync(join(tmpdir(), 'reefdoc-e2e-'));
  writeFileSync(join(tmp, 'doc.md'), DOC_MD);
  writeFileSync(join(tmp, 'sample.pdf'), PDF_BYTES);

  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  proc = spawn(join(repoRoot, 'reefdoc'), ['-addr', `127.0.0.1:${port}`, tmp], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  await waitForServer(base);
});

test.afterAll(async () => {
  if (proc) proc.kill('SIGKILL');
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

test('server is reachable and serves the app shell', async ({ page }) => {
  const res = await page.goto(base + '/');
  expect(res.ok()).toBeTruthy();
  // The file tree should list our seeded doc.
  await expect(page.locator('#tree')).toContainText('doc.md');
});
```

- [ ] **Step 2: Run the harness smoke test**

Run: `npm run e2e`
Expected: PASS (1 test). This proves: `go build` works, the binary spawns on a free port, the ready-poll works, Playwright connects, and the tree renders the fixture. If `go` is not on PATH, the build step throws a clear error — install Go and retry.

- [ ] **Step 3: Commit**

```bash
git add web/e2e/download.e2e.js
git commit -m "test(e2e): harness that builds and serves the real reefdoc binary"
```

---

## Task 3: The five download E2E test cases

**Files:**
- Modify: `web/e2e/download.e2e.js`

Add the real coverage. Each case uses stable selectors already in the markup:
- file tree row: `#tree .tree-item[data-path="<path>"]`
- download button: `#download-btn`
- tab close control: `.tab .close`

- [ ] **Step 1: Replace the smoke test with the five lifecycle/download tests**

In `web/e2e/download.e2e.js`, remove the `test('server is reachable ...')` smoke test and add the following. Note: `page.goto` with `localStorage` cleared on first load makes the "no document open" assertion deterministic (reefdoc persists tab sessions in `localStorage`).

```js
// Open the app with a clean slate: clear persisted session/tab state so no
// document auto-restores. Must run before app.js reads localStorage, so we
// navigate, clear, then reload.
async function freshPage(page) {
  await page.goto(base + '/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('#tree');
}

// Click a file row in the tree to open it as a tab.
async function openDoc(page, path) {
  await page.locator(`#tree .tree-item[data-path="${path}"]`).click();
}

test('download button is hidden when no document is open', async ({ page }) => {
  await freshPage(page);
  await expect(page.locator('#download-btn')).toBeHidden();
});

test('download button appears after opening a document', async ({ page }) => {
  await freshPage(page);
  await openDoc(page, 'doc.md');
  await expect(page.locator('#download-btn')).toBeVisible();
});

test('downloads a text document with correct name and contents', async ({ page }) => {
  await freshPage(page);
  await openDoc(page, 'doc.md');
  await expect(page.locator('#download-btn')).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#download-btn').click(),
  ]);
  expect(download.suggestedFilename()).toBe('doc.md');

  const savePath = join(tmp, 'downloaded-doc.md');
  await download.saveAs(savePath);
  const got = readFileSync(savePath);
  const want = readFileSync(join(tmp, 'doc.md'));
  expect(Buffer.compare(got, want)).toBe(0);
});

test('downloads a binary document with byte-for-byte fidelity', async ({ page }) => {
  await freshPage(page);
  await openDoc(page, 'sample.pdf');
  await expect(page.locator('#download-btn')).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#download-btn').click(),
  ]);
  expect(download.suggestedFilename()).toBe('sample.pdf');

  const savePath = join(tmp, 'downloaded-sample.pdf');
  await download.saveAs(savePath);
  const got = readFileSync(savePath);
  const want = readFileSync(join(tmp, 'sample.pdf'));
  expect(Buffer.compare(got, want)).toBe(0);
});

test('download button hides again after closing the last tab', async ({ page }) => {
  await freshPage(page);
  await openDoc(page, 'doc.md');
  await expect(page.locator('#download-btn')).toBeVisible();

  // Close every open tab via its × control.
  const closers = page.locator('.tab .close');
  for (let n = await closers.count(); n > 0; n = await closers.count()) {
    await closers.first().click();
  }
  await expect(page.locator('#download-btn')).toBeHidden();
});
```

- [ ] **Step 2: Run the full E2E suite**

Run: `npm run e2e`
Expected: PASS (5 tests). All five assert real user-visible behavior against the real binary.

- [ ] **Step 3: Sanity-check that the test actually guards the behavior**

Temporarily break the wiring to prove the test fails when the feature is broken:
1. In `web/app.js`, comment out the body of `refreshDownloadButton` so it becomes a no-op (the button never shows/hides).
2. Run `go build -o reefdoc .` is NOT needed manually — the E2E `beforeAll` rebuilds. Just run `npm run e2e`.
3. Expected: the "appears after opening" and "hides after closing" tests FAIL (button stays hidden/visible). This confirms the test has teeth.
4. Revert the change to `web/app.js` (restore the one-line body `downloadBtn.hidden = !store.active;`), run `go build` is again handled by `beforeAll`; run `npm run e2e` and confirm all 5 pass again.

Do not commit the temporary break. Verify `git diff web/app.js` is empty after reverting.

- [ ] **Step 4: Commit**

```bash
git add web/e2e/download.e2e.js
git commit -m "test(e2e): cover download button lifecycle and file fidelity"
```

---

## Task 4: CI job

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add the `e2e` job**

The current file has two jobs (`go`, `web`). Add a third job `e2e` at the same indentation level under `jobs:` (after the `web` job). Insert:

```yaml
  e2e:
    name: E2E (Playwright + real binary)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-go@v6
        with:
          go-version: '1.23'
          cache: true
      - uses: actions/setup-node@v6
        with:
          node-version: '22'
      - run: npm install
      - run: npx playwright install --with-deps chromium
      - run: npm run e2e
```

- [ ] **Step 2: Validate the workflow YAML locally**

Run:
```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml')); print('YAML OK')"
```
Expected: `YAML OK`. (Confirms the new job didn't break the file's structure/indentation.)

- [ ] **Step 3: Confirm the unit `web` job still excludes the E2E file**

Run: `npm test`
Expected: the existing 60 unit tests pass and the run does NOT execute `download.e2e.js` (node --test globs `*.test.js`, not `*.e2e.js`). Confirm the test count is unchanged at 60.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add e2e job running Playwright against the real binary"
```

---

## Task 5: Documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document how to run the E2E suite**

In `README.md`, find the testing line in the Status section (currently: "Run the tests with `go test ./...` and `npm test`.") and expand it to mention the E2E suite. Replace that sentence with:

```markdown
Run the unit tests with `go test ./...` and `npm test`. The browser end-to-end
test (Playwright, drives the real binary) runs with `npm run e2e` — it needs Go
on your PATH and Playwright's Chromium installed (`npx playwright install chromium`).
```

- [ ] **Step 2: Verify the README still reads cleanly**

Re-read the Status section to confirm the sentence flows and no version/blockquote was touched.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document the npm run e2e browser test"
```

---

## Self-Review Notes

- **Spec coverage:** Harness (build/spawn/free-port/ready-poll/cleanup) → Task 2. The 5 test cases (hidden / appears / text download+contents / binary download+contents / hides after close) → Task 3. Playwright dep + Chromium-only config → Task 1. Isolated `e2e` CI job → Task 4. `web` job stays clean via `*.e2e.js` naming → verified in Task 4 Step 3. Reliability mitigations (free port, ready-poll, localStorage clear, waitForEvent-before-click, afterAll kill) → all present in Tasks 2-3. The spec's "break the feature to prove the test has teeth" sanity step → Task 3 Step 3.
- **Placeholder scan:** No TBDs. Playwright pinned at `1.55.0` (Node 24 compatible; `1.48.2` deadlocks its TS-ESM loader on Node 24). The download API used (`waitForEvent('download')`, `download.saveAs`, `download.suggestedFilename`) is stable across 1.4x–1.5x.
- **Naming/selector consistency:** Selectors (`#download-btn`, `#tree .tree-item[data-path]`, `.tab .close`) verified against `web/app.js` and `web/index.html`. Helper names (`freshPage`, `openDoc`, `freePort`, `waitForServer`) are consistent across Tasks 2-3. `tmp`/`base`/`proc` module-level vars are shared between `beforeAll` and the tests.
