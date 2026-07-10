import * as vscode from 'vscode';
import {
  resolveBinaryPath,
  findFreePort,
  startServer,
  ReefdocServer,
} from './server';
import { createReefdocPanel } from './panel';

interface Live {
  panel: vscode.WebviewPanel;
  server: ReefdocServer;
}

let current: Live | undefined;
let starting = false;

async function openPreview(context: vscode.ExtensionContext): Promise<void> {
  if (current) {
    current.panel.reveal(vscode.ViewColumn.Beside);
    return;
  }
  if (starting) {
    return;
  }
  starting = true;
  try {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      vscode.window.showErrorMessage('reefdoc: Open a folder to preview.');
      return;
    }
    const root = folder.uri.fsPath;

    const cfg = vscode.workspace.getConfiguration('reefdoc');
    const host = cfg.get<string>('host', '127.0.0.1');
    const overridePath = cfg.get<string>('binaryPath', '');

    let binaryPath: string;
    try {
      binaryPath = overridePath || resolveBinaryPath(context.extensionPath);
    } catch (err) {
      vscode.window.showErrorMessage(`reefdoc: ${(err as Error).message}`);
      return;
    }

    let server: ReefdocServer;
    try {
      const port = await findFreePort();
      server = await startServer({ binaryPath, root, host, port });
    } catch (err) {
      vscode.window.showErrorMessage(`reefdoc: failed to start — ${(err as Error).message}`);
      return;
    }

    const panel = createReefdocPanel(server.url);
    current = { panel, server };
    context.subscriptions.push(panel);
    panel.onDidDispose(() => {
      server.stop();
      current = undefined;
    });
  } finally {
    starting = false;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand('reefdoc.openPreview', () =>
    openPreview(context),
  );
  context.subscriptions.push(disposable);
}

export function deactivate(): void {
  current?.server.stop();
  current = undefined;
}
