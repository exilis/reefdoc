// server.js — boot a real reefdoc binary for an E2E test.
//
// Each test gets its own server process, its own ephemeral port, and its own
// temp document directory, so tests are isolated and can mutate files on disk
// without interfering with each other.

import { spawn, execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

// Build the binary once per process; cache the path. Building up front (rather
// than `go run`) gives a stable, fast-starting server and a clear failure if
// the code doesn't compile.
let binaryPath = null;
function ensureBinary() {
  if (binaryPath) return binaryPath;
  const out = join(mkdtempSync(join(tmpdir(), 'reefdoc-e2e-bin-')), 'reefdoc');
  execSync(`go build -o "${out}" .`, { cwd: repoRoot, stdio: 'pipe' });
  binaryPath = out;
  return out;
}

// freePort asks the OS for an unused TCP port by binding to :0, then releasing
// it. reefdoc echoes its -addr verbatim (it doesn't report the OS-assigned port
// when given :0), so we pick the port ourselves and pass it explicitly.
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

// waitForReady polls the server's root until it responds (or times out).
async function waitForReady(baseURL, deadlineMs = 10_000) {
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(baseURL + '/');
      if (res.ok) return;
    } catch { /* not up yet */ }
    if (Date.now() - start > deadlineMs) {
      throw new Error('server did not become ready at ' + baseURL);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

// startServer launches reefdoc serving `dir` on a free port and resolves once
// the server answers HTTP. Returns { baseURL, stop() }.
export async function startServer(dir) {
  const bin = ensureBinary();
  const port = await freePort();
  const baseURL = `http://127.0.0.1:${port}`;
  const proc = spawn(bin, ['-addr', `127.0.0.1:${port}`, dir], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', (c) => { log += c.toString(); });
  proc.stderr.on('data', (c) => { log += c.toString(); });
  proc.on('exit', (code) => {
    if (code) log += `\n[server exited ${code}]`;
  });

  await waitForReady(baseURL);

  return {
    baseURL,
    stop() {
      try { proc.kill('SIGKILL'); } catch { /* already gone */ }
    },
  };
}

// makeDocsDir creates a fresh temp directory for a test's documents and returns
// its path plus a cleanup function.
export function makeDocsDir() {
  const dir = mkdtempSync(join(tmpdir(), 'reefdoc-e2e-docs-'));
  return { dir, cleanup() { rmSync(dir, { recursive: true, force: true }); } };
}
