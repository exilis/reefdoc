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
