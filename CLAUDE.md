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
