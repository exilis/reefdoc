import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand('reefdoc.openPreview', () => {
    vscode.window.showInformationMessage('reefdoc: Open Preview (stub)');
  });
  context.subscriptions.push(disposable);
}

export function deactivate(): void {
  // no-op until later tasks
}
