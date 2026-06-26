// Playwright config for reefdoc end-to-end tests.
//
// These tests drive a REAL reefdoc binary in a headless Chromium to verify the
// live-reload (auto-update) pipeline for binary document previews end-to-end:
// fsnotify -> watcher -> SSE -> frontend re-render. The binary viewer libraries
// normally load from a CDN; the tests stub that import (see web/e2e/fixtures.js)
// so they run fully offline and deterministically.
//
// Each test starts its own server on its own port against its own temp fixture
// directory (see web/e2e/server.js), so there is no shared web server here.

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './web/e2e',
  testMatch: '**/*.spec.js',
  // Live-reload involves real filesystem watching + a 100ms watcher debounce +
  // a 250ms client debounce, so give assertions room without being flaky.
  timeout: 30_000,
  expect: { timeout: 10_000 },
  // Filesystem-watch tests are timing-sensitive; run serially for stability.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'retain-on-failure',
  },
});
