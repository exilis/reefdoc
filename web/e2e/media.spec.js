// media.spec.js — end-to-end tests for inline media viewing against a real
// reefdoc server in a real browser.
//
// Media (video/image/audio) streams from /api/file directly — the frontend
// mounts a native <video>/<img>/<audio> element pointing at the server URL
// instead of fetching bytes. These tests assert the tree lists media files,
// the viewer mounts the right element, and the server honors Range requests
// (what <video> seeking relies on). No real codec decoding is asserted, so
// tiny fake bytes are fine.

import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startServer, makeDocsDir } from './server.js';

// 1x1 transparent PNG, a real decodable image.
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

let server;
let docs;

test.beforeAll(async () => {
  docs = makeDocsDir();
  writeFileSync(join(docs.dir, 'clip.mp4'), Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
  writeFileSync(join(docs.dir, 'shot.png'), PNG_BYTES);
  writeFileSync(join(docs.dir, 'note.md'), '# still works\n');
  server = await startServer(docs.dir);
});

test.afterAll(async () => {
  server?.stop();
  docs?.cleanup();
});

test('media files appear in the tree and open in native viewers', async ({ page }) => {
  await page.goto(server.baseURL);

  // Both media files are listed alongside the markdown file.
  await expect(page.locator('.tree-file .tree-label', { hasText: 'clip.mp4' })).toBeVisible();
  await expect(page.locator('.tree-file .tree-label', { hasText: 'shot.png' })).toBeVisible();

  // Clicking the video mounts a <video controls> streaming from /api/file.
  await page.locator('.tree-file .tree-label', { hasText: 'clip.mp4' }).click();
  const video = page.locator('#content .media-video video');
  await expect(video).toBeAttached();
  await expect(video).toHaveAttribute('controls', '');
  expect(await video.getAttribute('src')).toContain('/api/file?path=clip.mp4');

  // Clicking the image mounts an <img> that actually loads (real PNG bytes).
  await page.locator('.tree-file .tree-label', { hasText: 'shot.png' }).click();
  const img = page.locator('#content .media-image img');
  await expect(img).toBeVisible();
  await expect
    .poll(() => img.evaluate((el) => el.complete && el.naturalWidth))
    .toBe(1);

  // Markdown still renders after media viewing.
  await page.locator('.tree-file .tree-label', { hasText: 'note.md' }).click();
  await expect(page.locator('#content h1')).toHaveText('still works');
});

test('server honors Range requests on media', async () => {
  const res = await fetch(server.baseURL + '/api/file?path=clip.mp4', {
    headers: { Range: 'bytes=2-5' },
  });
  expect(res.status).toBe(206);
  expect(res.headers.get('content-range')).toBe('bytes 2-5/10');
  expect(res.headers.get('content-type')).toBe('video/mp4');
  const body = Buffer.from(await res.arrayBuffer());
  expect([...body]).toEqual([2, 3, 4, 5]);
});
