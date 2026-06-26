// Playwright config for reefdoc end-to-end tests.
//
// Two suites live here, both driving a REAL reefdoc binary in headless Chromium:
//   - web/e2e/download.e2e.js — the document-download button + ?download=1 flow.
//   - web/e2e/binary-live-reload.spec.js — live-reload (auto-update) for binary
//     document previews (fsnotify -> watcher -> SSE -> frontend re-render). The
//     binary viewer libraries normally load from a CDN; that import is stubbed
//     (see web/e2e/fixtures.js) so the suite runs fully offline.
//
// Each test starts its own server on its own port against its own temp fixture
// directory, so there is no shared web server here. testMatch covers both the
// *.e2e.js and *.spec.js naming conventions while excluding the non-test
// helpers (fixtures.js, server.js).

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './web/e2e',
  testMatch: '**/*.{e2e,spec}.js',
  // Live-reload involves real filesystem watching + a 100ms watcher debounce +
  // a 250ms client debounce, so give assertions room without being flaky.
  timeout: 30_000,
  expect: { timeout: 10_000 },
  // Filesystem-watch + real-binary tests are timing-sensitive; run serially.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  outputDir: './test-results',
  use: {
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
