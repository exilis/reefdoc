<!-- agent-policy:start (managed block — do not edit inside markers) -->
# Agent Policy (strict)

These rules bind every AI agent working in this repository. They override
default agent behavior. Project instructions below may add to them but
never loosen them.

## Git
- Do NOT commit, push, tag, rebase, force-push, or `reset --hard` unless
  the user explicitly requests it in the current session.
- Never push directly to `main`/`master`. Never rewrite published history.
- At handoff, report changed files and propose exact git commands instead
  of running them.

## Secrets & data
- Never read, print, copy, or commit secrets: `.env*`, `.secrets/`,
  `*.pem`, tokens, API keys, customer data.
- Never send repository contents to external services without explicit
  approval.

## Safety
- No destructive filesystem operations (`rm -rf`, bulk deletes) outside
  paths you created this session.
- No dependency upgrades, lockfile regeneration, schema or public-API
  changes unless explicitly requested.

## Scope & quality
- Make the smallest change that satisfies the request; do not refactor
  unrelated code.
- Run the repo's tests/linters before claiming work is done; report
  failures honestly — never claim success without verification.

## Tracking & handoff
- If this repo has `.beads/`, track work with `bd` (run `bd prime`);
  otherwise do not create markdown TODO files.
- End every session with: what changed, what was verified, and suggested
  next commands (including any commit you propose).
<!-- agent-policy:end -->

# reefdoc — project instructions

## Release process (follow every time a version ships)

A version is **not released** until all of these exist and agree:

1. `CHANGELOG.md` has a `## [X.Y.Z] - YYYY-MM-DD` entry **and** a matching
   link reference at the bottom of the file
   (`[X.Y.Z]: https://github.com/exilis/reefdoc/releases/tag/vX.Y.Z`).
2. An annotated git tag `vX.Y.Z` exists on the release commit and is pushed
   (`git tag -a vX.Y.Z -m "vX.Y.Z" <commit> && git push origin vX.Y.Z`).
   Pushing the tag triggers `.github/workflows/release.yml`, which builds
   binaries and publishes the GitHub release automatically — do not create
   releases by hand.
3. `README.md`'s "Latest release" callout points at the new version with a
   one-line highlight.

**Never add a versioned CHANGELOG entry without tagging.** If work merges that
isn't ready to release, keep it under an `## [Unreleased]` heading and fold it
into the next versioned entry at release time.

Before claiming docs/releases are in sync, verify:
`git tag --sort=-v:refname | head -3` matches the top of `CHANGELOG.md` and
the README callout.

## Testing

- Go: `go test ./...` (CI also runs `-race`, `go vet`, and gofmt checks)
- Frontend: `npm test`
- Browser E2E: `npm run e2e` (Playwright Chromium + Go on PATH required)

## Conventions

- Commit style: conventional-commit-ish prefixes (`feat:`, `fix:`, `docs:`,
  `test(e2e):`, ...), as in `git log`.
- Design docs live in `docs/specs/`, implementation plans in `docs/plans/`,
  named `YYYY-MM-DD-<topic>[-design].md`.
- Frontend is vanilla JS embedded in the Go binary; new `web/*` assets must be
  added to the embed set (a smoke test checks every `web/*` asset is served).
