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
