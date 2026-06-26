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
// `exited` is a function returning true once the child process has gone away,
// so a failed bind rejects promptly instead of burning the whole deadline.
async function waitForReady(baseURL, exited, deadlineMs = 5_000) {
  const start = Date.now();
  for (;;) {
    if (exited()) {
      throw new Error('server process exited before becoming ready at ' + baseURL);
    }
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
//
// freePort() picks a port by binding :0 and immediately releasing it; in the
// gap before reefdoc binds, another process could steal that port and the spawn
// would fail to bind. To stay robust we retry the whole pick-port -> spawn ->
// waitForReady sequence with a fresh port each attempt, and surface the child's
// captured output if every attempt fails.
export async function startServer(dir) {
  const bin = ensureBinary();
  const maxAttempts = 5;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const port = await freePort();
    const baseURL = `http://127.0.0.1:${port}`;
    const proc = spawn(bin, ['-addr', `127.0.0.1:${port}`, dir], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let log = '';
    let exited = false;
    proc.stdout.on('data', (c) => { log += c.toString(); });
    proc.stderr.on('data', (c) => { log += c.toString(); });
    proc.on('exit', (code) => {
      exited = true;
      if (code) log += `\n[server exited ${code}]`;
    });

    try {
      await waitForReady(baseURL, () => exited);
      return {
        baseURL,
        stop() {
          try { proc.kill('SIGKILL'); } catch { /* already gone */ }
        },
      };
    } catch (err) {
      // This attempt failed (early exit or readiness timeout). Kill the child
      // and try a fresh port. Stash the error + captured log for the final throw.
      try { proc.kill('SIGKILL'); } catch { /* already gone */ }
      lastError = new Error(
        `${err.message} (attempt ${attempt}/${maxAttempts})\n--- server log ---\n${log}`,
      );
    }
  }

  throw new Error(
    `server failed to start after ${maxAttempts} attempts.\n${lastError?.message ?? ''}`,
  );
}

// makeDocsDir creates a fresh temp directory for a test's documents and returns
// its path plus a cleanup function.
export function makeDocsDir() {
  const dir = mkdtempSync(join(tmpdir(), 'reefdoc-e2e-docs-'));
  return { dir, cleanup() { rmSync(dir, { recursive: true, force: true }); } };
}
