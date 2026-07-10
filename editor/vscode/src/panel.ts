import * as vscode from 'vscode';

function webviewHtml(url: string): string {
  const origin = new URL(url).origin;
  const csp = [
    "default-src 'none'",
    `frame-src ${origin}`,
    "style-src 'unsafe-inline'",
  ].join('; ');
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<style>
  html, body { margin: 0; padding: 0; height: 100%; width: 100%; overflow: hidden; }
  iframe { border: 0; width: 100%; height: 100%; display: block; }
</style>
</head>
<body>
  <iframe src="${url}" title="reefdoc preview"></iframe>
</body>
</html>`;
}

export function createReefdocPanel(url: string): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel(
    'reefdoc.preview',
    'reefdoc',
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  panel.webview.html = webviewHtml(url);
  return panel;
}
