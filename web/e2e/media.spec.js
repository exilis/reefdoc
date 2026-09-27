// media.spec.js — end-to-end tests for inline media viewing against a real
// reefdoc server in a real browser.
//
// Media (video/image/audio) streams from /api/file directly — the frontend
// mounts a native <video>/<img>/<audio> element pointing at the server URL
// instead of fetching bytes. These tests assert the tree lists media files,
// playable media keeps its native player, unplayable media (container/codec
// the browser can't decode — e.g. .mkv outside Chromium, or a bad file) is
// replaced by a clear message with a download link, and the server honors
// Range requests (what <video> seeking relies on).
//
// Fixtures: the WAV is real and decodable (trivial to construct: RIFF header
// + PCM silence). The mp4/mkv bytes are garbage — no ffmpeg here to make real
// ones — so video fixtures exercise the HTTP layer and the error-fallback
// path, not actual decoding. Chromium playing a *real* .mkv is therefore not
// asserted, only that .mkv is offered and degrades honestly.

import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startServer, makeDocsDir } from './server.js';

// 1x1 transparent PNG, a real decodable image.
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

// A real, decodable WAV: 44-byte RIFF/fmt/data header + 0.1s of 8kHz PCM silence.
function wavBytes() {
  const sampleRate = 8000;
  const data = Buffer.alloc((sampleRate / 10) * 2); // 16-bit mono silence
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); // fmt chunk size
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28); // byte rate
  h.writeUInt16LE(2, 32); // block align
  h.writeUInt16LE(16, 34); // bits per sample
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

let server;
let docs;

test.beforeAll(async () => {
  docs = makeDocsDir();
  writeFileSync(join(docs.dir, 'clip.mp4'), Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
  writeFileSync(join(docs.dir, 'render.mkv'), Buffer.from('not really matroska'));
  writeFileSync(join(docs.dir, 'tone.wav'), wavBytes());
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

  // All media files are listed alongside the markdown file — including .mkv.
  for (const name of ['clip.mp4', 'render.mkv', 'tone.wav', 'shot.png']) {
    await expect(page.locator('.tree-file .tree-label', { hasText: name })).toBeVisible();
  }

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

test('playable media keeps its native player (real WAV loads metadata)', async ({ page }) => {
  await page.goto(server.baseURL);
  await page.locator('.tree-file .tree-label', { hasText: 'tone.wav' }).click();
  const audio = page.locator('#content .media-audio audio');
  await expect(audio).toBeAttached();
  await expect(audio).toHaveAttribute('controls', '');
  // Metadata loads — the browser can actually decode this file.
  await expect
    .poll(() => audio.evaluate((el) => el.readyState >= 1))
    .toBe(true);
  await expect(page.locator('#content .media-error')).toHaveCount(0);
});

test('unplayable media is replaced by a clear message with a working download link', async ({ page }) => {
  await page.goto(server.baseURL);
  await page.locator('.tree-file .tree-label', { hasText: 'render.mkv' }).click();

  // The bytes aren't decodable, so the player gives way to an explanation —
  // this is exactly what a Firefox/Safari user sees for any .mkv.
  const msg = page.locator('#content .media-error');
  await expect(msg).toBeVisible();
  await expect(msg).toContainText('render.mkv');

  const href = await msg.locator('a').getAttribute('href');
  expect(href).toContain('/api/file?path=render.mkv');
  expect(href).toContain('download=1');

  // The download link actually serves the file as an attachment.
  const res = await fetch(server.baseURL + href);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-disposition')).toContain('render.mkv');
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

test('server serves .mkv as video/x-matroska with Range support', async () => {
  const res = await fetch(server.baseURL + '/api/file?path=render.mkv', {
    headers: { Range: 'bytes=0-2' },
  });
  expect(res.status).toBe(206);
  expect(res.headers.get('content-type')).toBe('video/x-matroska');
  const body = Buffer.from(await res.arrayBuffer());
  expect(body.toString()).toBe('not');
});
