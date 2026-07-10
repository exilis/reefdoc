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
