import * as net from 'node:net';
import * as path from 'node:path';
import { spawn, ChildProcess } from 'node:child_process';
import * as http from 'node:http';

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
