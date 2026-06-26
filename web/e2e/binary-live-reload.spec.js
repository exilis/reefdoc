// binary-live-reload.spec.js — end-to-end tests for auto-updating binary
// document previews in a real browser against a real reefdoc server.
//
// These verify the live-reload PLUMBING (a disk change re-renders the open
// preview) without depending on the real CDN viewer libraries: the pdfjs import
// is stubbed (see fixtures.js) so a ".pdf" whose bytes are UTF-8 text renders
// that text where we can assert on it.

import { test, expect } from '@playwright/test';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { startServer, makeDocsDir } from './server.js';
import { installPdfStub } from './fixtures.js';

// Write a fake "pdf" whose bytes are just the given text (not a real PDF). Our
// stubbed viewer decodes the bytes to text, so the rendered preview shows
// exactly `content`.
function writeFakePdf(dir, name, content) {
  writeFileSync(join(dir, name), content);
}

// openFile clicks a file row in the tree by its filename.
async function openFile(page, name) {
  await page.locator('.tree-file .tree-label', { hasText: name }).click();
}

// The stubbed PDF preview surfaces its decoded content in a <pre.fake-pdf-text>.
function previewText(page) {
  return page.locator('#content .fake-pdf-text');
}

test.describe('binary document live-reload', () => {
  let docs, server;

  test.beforeEach(async ({ page }) => {
    docs = makeDocsDir();
    // Stub the CDN PDF viewer BEFORE the page loads any module.
    await installPdfStub(page);
    server = await startServer(docs.dir);
  });

  test.afterEach(async () => {
    server?.stop();
    docs?.cleanup();
  });

  test('active PDF preview auto-updates when the file changes on disk', async ({ page }) => {
    writeFakePdf(docs.dir, 'report.pdf', 'VERSION-ONE');
    await page.goto(server.baseURL);

    // Open the PDF; the stubbed viewer renders its bytes as text.
    await openFile(page, 'report.pdf');
    await expect(previewText(page)).toHaveText('VERSION-ONE');

    // Change the file on disk — the open, active preview must re-render.
    writeFakePdf(docs.dir, 'report.pdf', 'VERSION-TWO-CHANGED');
    await expect(previewText(page)).toHaveText('VERSION-TWO-CHANGED');
  });

  test('background PDF tab is flagged and re-renders on activation', async ({ page }) => {
    writeFakePdf(docs.dir, 'report.pdf', 'PDF-ORIGINAL');
    writeFileSync(join(docs.dir, 'notes.md'), '# notes\n');
    await page.goto(server.baseURL);

    // Open the PDF, then switch to the markdown tab so the PDF is in the
    // background.
    await openFile(page, 'report.pdf');
    await expect(previewText(page)).toHaveText('PDF-ORIGINAL');
    await openFile(page, 'notes.md');
    await expect(page.locator('#content')).toContainText('notes');

    // Change the backgrounded PDF on disk.
    writeFakePdf(docs.dir, 'report.pdf', 'PDF-UPDATED-IN-BG');

    // Its tab gets the "updated" marker, but the visible pane (markdown) does
    // not change.
    const pdfTab = page.locator('#tabbar .tab', { hasText: 'report.pdf' });
    await expect(pdfTab).toHaveClass(/updated/);
    await expect(page.locator('#content')).toContainText('notes');

    // Clicking the PDF tab renders the NEW content and clears the marker.
    await pdfTab.click();
    await expect(previewText(page)).toHaveText('PDF-UPDATED-IN-BG');
    await expect(pdfTab).not.toHaveClass(/updated/);
  });

  test('deleting the active PDF shows the missing-file state', async ({ page }) => {
    writeFakePdf(docs.dir, 'report.pdf', 'SOON-GONE');
    await page.goto(server.baseURL);

    await openFile(page, 'report.pdf');
    await expect(previewText(page)).toHaveText('SOON-GONE');

    // Delete the file on disk; the active preview should show the missing state.
    rmSync(join(docs.dir, 'report.pdf'));
    await expect(page.locator('#content')).toContainText('This file no longer exists.');
  });
});
