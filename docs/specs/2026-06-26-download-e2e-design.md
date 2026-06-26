# Browser E2E Test for Document Download — Design

**Date:** 2026-06-26
**Status:** Approved (brainstorming) — ready for implementation plan

## Summary

Add a Playwright browser end-to-end test that drives the **real `reefdoc`
binary** and verifies the document-download feature exactly as a user
experiences it: the download button's visibility lifecycle, the click → native
browser download, the correct suggested filename, and byte-for-byte fidelity of
the saved file (text and binary).

This closes the one remaining gap in the download feature's test coverage. The
Go handler tests (`internal/server/server_test.go`) and the HTTP-level E2E
(`internal/server/e2e_test.go`) verify the server's `?download=1` behavior, but
the browser side — the `#download-btn` show/hide wiring and the temporary-anchor
click → download — is currently only verified by inspection. This test exercises
that path through a real browser against the real binary.

## Goals

- Verify, through a real browser against the real binary, that:
  - the download button is hidden when no document is open;
  - it appears when a document is opened;
  - clicking it downloads the open document with the correct filename;
  - the downloaded bytes equal the original file on disk (text and binary);
  - the button hides again after the last tab is closed.
- Run in CI automatically as an isolated job, without slowing the existing fast
  `go` and `web` jobs.
- Keep the shipped binary and its runtime zero-added-dependency: Playwright is a
  dev/test dependency only.

## Non-Goals (YAGNI)

- Multi-browser matrix — Chromium only.
- Visual / screenshot regression.
- Making the `e2e` CI job a required status check by default (a separate repo
  settings decision).
- Replacing the existing Go handler tests or HTTP-level E2E — this complements
  them.
- A stubbed/standalone asset server — the test drives the real binary for full
  fidelity.

## Test Harness

A new test file `web/e2e/download.e2e.js`, run by Playwright (not `node --test`,
which lacks browser fixtures).

- **Boot the real binary.** In `beforeAll`: run `go build -o reefdoc .`, then
  spawn `./reefdoc -addr 127.0.0.1:<port> <tmpdir>` as a child process, where
  `<tmpdir>` is a fixture directory seeded with known files. Playwright connects
  to `http://127.0.0.1:<port>`. This serves the real embedded assets and the
  real `/api/file?download=1` path.
- **Free-port selection.** Pick an ephemeral free port at runtime (bind a
  throwaway listener to `:0`, read the assigned port, release it) to avoid the
  stale-server port collisions seen during development.
- **Server-ready wait.** Poll `GET /` until it returns 200 (with a timeout)
  before any Playwright navigation, so the test never races server startup.
- **Cleanup.** `afterAll` always kills the child process and removes the temp
  dir, even on test failure, so CI does not leak a server.
- **Fixture content.** The temp dir is seeded at runtime (keeping the repo
  clean) with a text file `doc.md` (known contents) and a small binary file
  `sample.pdf` (known bytes).

## Test Cases

A single spec file covering the full lifecycle:

1. **Button hidden when no document is open.** Load `/` fresh with `localStorage`
   cleared (so reefdoc's session-restore does not auto-open a tab). Assert
   `#download-btn` is hidden.
2. **Button appears after opening a document.** Click `doc.md` in the file tree.
   Assert `#download-btn` becomes visible.
3. **Download — filename + contents (text).** Set up
   `page.waitForEvent('download')` before clicking `#download-btn`. Assert
   `download.suggestedFilename() === 'doc.md'`; `download.saveAs(<tmp>)`; assert
   the saved bytes equal the original `doc.md` on disk.
4. **Download fidelity (binary).** Open `sample.pdf`, click `#download-btn`,
   assert filename `sample.pdf`, and that the saved bytes exactly equal the
   original PDF bytes.
5. **Button hides after closing the last tab.** Close the open tab(s) via the
   tab `×` control. Assert `#download-btn` is hidden again.

**Selectors** use the stable markup already present: `#download-btn`,
`#tree .tree-item`, `.tab .close`. Assertions target user-visible outcomes
(visibility, the actual downloaded file), not internals.

## Dependencies, Config & Layout

**npm (`package.json`):**
- Add `@playwright/test` to `devDependencies`.
- Add script `"e2e": "playwright test"`.
- Playwright's Chromium browser is installed in CI via
  `npx playwright install --with-deps chromium`.

**`playwright.config.js`** (repo root):
- `testDir` → `web/e2e`.
- Chromium project only.
- Sensible timeout; artifacts/output dir configured.
- No `webServer` block — the test manages the Go binary lifecycle itself, since
  it must `go build` first.

**Keeping the `web` job clean:** the existing `web` job runs `node --test`, which
globs `*.test.js`. The E2E file is `*.e2e.js` under `web/e2e/`, so `node --test`
does not pick it up. (Verify the glob exclusion during implementation.)

**New CI job `e2e` (`.github/workflows/ci.yml`):**
```yaml
e2e:
  name: E2E (Playwright + real binary)
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v6
    - uses: actions/setup-go@v6
      with: { go-version: '1.23', cache: true }
    - uses: actions/setup-node@v6
      with: { node-version: '22' }
    - run: npm install
    - run: npx playwright install --with-deps chromium
    - run: npm run e2e
```
Runs in parallel with `go` and `web`. The test builds reefdoc itself, so no
separate Go build step is needed beyond the toolchain.

**Layout:**
- `web/e2e/download.e2e.js` — the test
- `playwright.config.js` — config
- `package.json` — devDep + `e2e` script
- `.github/workflows/ci.yml` — new `e2e` job
- `.gitignore` — Playwright artifacts (`test-results/`, `playwright-report/`)
  and the `/reefdoc` test binary if not already ignored

## Edge Cases & Reliability

- **Free-port selection** avoids stale-server collisions.
- **Server-ready polling** before navigation avoids startup races.
- **`localStorage` cleared on load** so case 1 is deterministic and unaffected by
  session/tab persistence.
- **`waitForEvent('download')` set up before the click** to avoid a download
  race.
- **`afterAll` always kills the child binary**, even on failure, so CI does not
  leak a server.

## Risks & Mitigations

- **CI cost/slowness:** the browser install adds time; isolated in its own
  parallel job, single browser (Chromium only).
- **Dependency weight vs. project ethos:** Playwright is a heavy dev dependency
  in an otherwise minimal repo. Accepted deliberately for true download-event
  fidelity. It is a dev/test dependency only — the shipped binary and runtime
  stay zero-added-dependency, so the "self-contained binary" promise is intact.
- **`go build` from the JS test:** the test shells out to the Go toolchain. The
  `e2e` CI job installs Go; locally it requires Go on PATH (noted in the test).

## Testing

This *is* a test. Its own verification: the `e2e` job passing in CI, and a local
`npm run e2e` passing (requires Go + Playwright's Chromium installed). A
deliberate manual sanity step during implementation: temporarily break the
feature (e.g. remove the `refreshDownloadButton()` call) and confirm the E2E
fails, proving the test actually guards the behavior.
