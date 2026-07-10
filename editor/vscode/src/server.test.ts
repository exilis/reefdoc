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
