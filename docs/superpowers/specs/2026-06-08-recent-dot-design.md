# Recently-updated dot in the file tree

## Goal

Visually mark recently-updated documents in reefdoc's file tree so a user can
see at a glance which docs have changed.

## Decisions

- **What is marked:** files only. Directories are not marked.
- **"Recent":** modified within the last 24 hours (a fixed time window).
- **Visual:** a small accent-colored dot at the right edge of the tree row.
- **Live:** the dot appears/refreshes immediately via the existing SSE stream,
  not only on page reload.
- **Favorites:** left unmarked in v1 (see Scope cuts).

## Backend — `internal/server/tree.go`

Add a field to `Node`:

```go
ModTime int64 `json:"modTime,omitempty"` // unix millis; set for files only
```

In `ListDir`, for each **file** entry, call `e.Info()` and set
`ModTime = info.ModTime().UnixMilli()`. If `Info()` returns an error, leave
`ModTime` at 0 (the file simply gets no dot). Directory nodes do not get a
`ModTime`.

The raw mtime is exposed rather than a pre-computed `recent` boolean. This keeps
the 24h threshold on the client and lets the dot age out naturally whenever a
level is re-rendered. No changes to `handleTree` or any other handler.

## Frontend — `web/app.js`

- Constant `RECENT_MS = 24 * 60 * 60 * 1000`.
- Helper `isRecent(modTime)` → `modTime && (Date.now() - modTime) < RECENT_MS`.
- `makeRecentDot()` → `<span class="recent-dot" title="Updated in the last 24h">`.
- In `renderNode`, for files only: if `isRecent(node.modTime)`, insert the dot
  **between the label and the star**. Row layout becomes
  `[icon][label flex:1][dot][star]`, so the dot sits at the right edge.

### Live updates — `connectSSE`

- `type:"change"` (a save to an existing file — emits only `change`, never
  `tree`): extend the existing handler to also locate
  `.tree-item[data-path="<path>"]` and add the dot if it is not already present.
  A `change` event means the file was just written, so it is recent by
  definition; no mtime check needed.
- `type:"tree"` (add/rename/delete within a dir): already triggers
  `reloadLevel` → re-fetch → `renderNode`, which recomputes dots from the fresh
  `modTime`. No additional work required.

## CSS — `web/app.css`

```css
.recent-dot { flex:0 0 auto; width:6px; height:6px; border-radius:50%;
              background:var(--accent); margin-left:6px; }
```

Reuses `--accent`, consistent with the existing tab "updated" indicator
(`.tab.updated::after`) and the file-change flash animation.

## Scope cuts

- **Favorites unmarked.** The favorites store holds only `{path, isDir}` with no
  mtime, and favorited files are not necessarily expanded in the tree, so there
  is no reliable mtime to test without extra per-favorite fetches. Marking
  favorites would require threading mtime into the favorites store; deferred.

## Testing

- **Go (`tree_test.go`):** a `ListDir` test asserting a freshly-written `.md`
  file carries a non-zero `ModTime`, and that directory nodes carry `0`.
- **Manual:** open the app; `touch`/edit a doc and confirm the dot appears live
  without reload; confirm a file with an old mtime shows no dot.
