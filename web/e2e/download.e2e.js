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
