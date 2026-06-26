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

// Poll GET / until 200 or timeout. Bails fast (with the real reason) if the
// spawned binary exits before becoming ready, instead of waiting the full
// timeout and throwing a vague message.
async function waitForServer(base, proc, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc?.exitInfo) {
      throw new Error(
        `reefdoc exited before becoming ready (code=${proc.exitInfo.code}, ` +
        `signal=${proc.exitInfo.signal}); see stderr above`
      );
    }
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
  proc.on('exit', (code, signal) => { proc.exitInfo = { code, signal }; });
  await waitForServer(base, proc);
});

test.afterAll(async () => {
  if (proc) proc.kill('SIGKILL');
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

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
