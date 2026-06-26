# Recently-updated dot in the file tree — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mark files modified within the last 24 hours with a small accent dot at the right edge of their file-tree row, updating live via the existing SSE stream.

**Architecture:** The backend exposes each file's modification time (unix millis) on the tree `Node`. The frontend has a pure `isRecent(modTime)` helper (its own module, unit-tested) and renders a `.recent-dot` span on recent file rows. A `change` SSE event (a save to an existing file) adds the dot to the already-rendered row; a `tree` SSE event already re-fetches and re-renders the level, recomputing dots for free. Directories and favorites are not marked.

**Tech Stack:** Go (`net/http`, `os`) for the backend; vanilla ES-module JavaScript with `node:test` for frontend unit tests.

**Source spec:** `docs/specs/2026-06-08-recent-dot-design.md`

---

## File Structure

- `internal/server/tree.go` — **modify**: add `ModTime` field to `Node`; populate it for files in `ListDir`.
- `internal/server/tree_test.go` — **modify**: add a test asserting files carry a non-zero `ModTime` and dirs carry `0`.
- `web/recency.js` — **create**: pure recency helper (`RECENT_MS`, `isRecent`).
- `web/recency.test.js` — **create**: `node:test` unit tests for `isRecent`.
- `web/app.js` — **modify**: import `isRecent`; add `makeRecentDot()` and `markRecentInTree()`; render the dot in `renderNode`; mark on `change` SSE events.
- `web/app.css` — **modify**: add `.recent-dot` rule.

No `index.html` change: `app.js` is bundled from its imports (same as `favorites.js`), so importing `recency.js` is enough.

**Test commands** (Go is invoked as `go`; if not on PATH, the executor should locate the toolchain first):
- Backend: `go test ./internal/server/...`
- Frontend: `npm test` (runs `node --test` over `web/*.test.js`), or a single file with `node --test web/recency.test.js`

---

## Task 1: Backend — expose file modification time on `Node`

**Files:**
- Modify: `internal/server/tree.go:12-17` (struct) and `internal/server/tree.go:54-56` (file branch)
- Test: `internal/server/tree_test.go`

- [ ] **Step 1: Write the failing test**

Add this test function to the end of `internal/server/tree_test.go`:

```go
func TestListDir_FilesCarryModTime(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "a.md"))
	writeFile(t, filepath.Join(root, "sub", "deep.md"))

	nodes, err := ListDir(root, "")
	if err != nil {
		t.Fatal(err)
	}
	// nodes are: "sub" (dir) then "a.md" (file)
	for _, n := range nodes {
		if n.IsDir {
			if n.ModTime != 0 {
				t.Fatalf("dir %q should have zero ModTime, got %d", n.Name, n.ModTime)
			}
		} else if n.ModTime == 0 {
			t.Fatalf("file %q should have a non-zero ModTime", n.Name)
		}
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `go test ./internal/server/ -run TestListDir_FilesCarryModTime -v`
Expected: compile error — `n.ModTime undefined (type *Node has no field or method ModTime)`.

- [ ] **Step 3: Add the `ModTime` field to `Node`**

In `internal/server/tree.go`, change the struct (lines 12-17) to:

```go
type Node struct {
	Name     string  `json:"name"`
	Path     string  `json:"path"`
	IsDir    bool    `json:"isDir"`
	ModTime  int64   `json:"modTime,omitempty"` // unix millis; set for files only
	Children []*Node `json:"children,omitempty"`
}
```

- [ ] **Step 4: Populate `ModTime` for files in `ListDir`**

In `internal/server/tree.go`, replace the file branch (currently lines 54-56):

```go
		} else if isMarkdown(name) {
			nodes = append(nodes, &Node{Name: name, Path: childRel, IsDir: false})
		}
```

with:

```go
		} else if isMarkdown(name) {
			n := &Node{Name: name, Path: childRel, IsDir: false}
			if info, err := e.Info(); err == nil {
				n.ModTime = info.ModTime().UnixMilli()
			}
			nodes = append(nodes, n)
		}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `go test ./internal/server/ -run TestListDir_FilesCarryModTime -v`
Expected: PASS.

- [ ] **Step 6: Run the full server package to confirm nothing regressed**

Run: `go test ./internal/server/...`
Expected: PASS (existing `TestListDir_*` tests still pass — `ModTime` is additive and `omitempty` keeps JSON output unchanged for dirs).

- [ ] **Step 7: Commit**

```bash
git add internal/server/tree.go internal/server/tree_test.go
git commit -m "feat(server): expose file modTime on tree nodes"
```

---

## Task 2: Frontend — pure recency helper module

**Files:**
- Create: `web/recency.js`
- Test: `web/recency.test.js`

- [ ] **Step 1: Write the failing test**

Create `web/recency.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRecent, RECENT_MS } from './recency.js';

test('isRecent is true within the window', () => {
  const now = 1_000_000_000_000;
  assert.equal(isRecent(now - 1000, now), true);
});

test('isRecent is false at or past the window edge', () => {
  const now = 1_000_000_000_000;
  assert.equal(isRecent(now - RECENT_MS, now), false);
  assert.equal(isRecent(now - RECENT_MS - 1, now), false);
});

test('isRecent is false for missing or zero mtime', () => {
  const now = 1_000_000_000_000;
  assert.equal(isRecent(0, now), false);
  assert.equal(isRecent(undefined, now), false);
});

test('isRecent treats a future mtime as recent', () => {
  const now = 1_000_000_000_000;
  assert.equal(isRecent(now + 5000, now), true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test web/recency.test.js`
Expected: FAIL — cannot find module `./recency.js`.

- [ ] **Step 3: Write the module**

Create `web/recency.js`:

```js
// Pure recency check: is a unix-millis modification time within the recent
// window? `now` is injectable so tests are deterministic; it defaults to the
// current time. A zero/undefined modTime (no info available) is never recent.
export const RECENT_MS = 24 * 60 * 60 * 1000; // 24 hours

export function isRecent(modTime, now = Date.now()) {
  return !!modTime && now - modTime < RECENT_MS;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test web/recency.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/recency.js web/recency.test.js
git commit -m "feat(web): add pure isRecent recency helper"
```

---

## Task 3: Frontend — render the dot and update it live

No automated test for this task (DOM rendering and SSE wiring); it is verified manually in Step 6. The recency logic it depends on is already covered by Task 2.

**Files:**
- Modify: `web/app.js:5` (import), `web/app.js:22-27` (after `makeIcon`), `web/app.js:235-239` (file branch of `renderNode`), `web/app.js:455-460` (`change` SSE handler)
- Modify: `web/app.css` (append rule)

- [ ] **Step 1: Import `isRecent`**

In `web/app.js`, after line 5 (the `favorites.js` import), add:

```js
import { isRecent } from './recency.js';
```

- [ ] **Step 2: Add `makeRecentDot` and `markRecentInTree` helpers**

In `web/app.js`, immediately after the `makeIcon` function (after line 27), add:

```js
// A small accent dot marking a file modified within the recent window.
function makeRecentDot() {
  const dot = document.createElement('span');
  dot.className = 'recent-dot';
  dot.title = 'Updated in the last 24h';
  return dot;
}

// Ensure the file row for `path` shows a recent dot (used on live `change`
// events). No-op for directories or rows not currently rendered.
function markRecentInTree(path) {
  const item = document.querySelector(`.tree-file[data-path="${CSS.escape(path)}"]`);
  if (!item || item.querySelector('.recent-dot')) return;
  item.insertBefore(makeRecentDot(), item.querySelector('.star'));
}
```

- [ ] **Step 3: Render the dot in `renderNode` for recent files**

In `web/app.js`, replace the file branch of `renderNode` (currently lines 235-239):

```js
  } else {
    item.dataset.path = node.path;
    item.appendChild(makeStar(node.path, false));
    item.addEventListener('click', () => open(node.path, node.name));
  }
```

with:

```js
  } else {
    item.dataset.path = node.path;
    if (isRecent(node.modTime)) item.appendChild(makeRecentDot());
    item.appendChild(makeStar(node.path, false));
    item.addEventListener('click', () => open(node.path, node.name));
  }
```

This yields row order `[icon][label][dot][star]`; the `flex:1` label pushes the dot and star to the right edge.

- [ ] **Step 4: Mark the dot live on `change` SSE events**

In `web/app.js`, in `connectSSE`, replace the `change` branch (currently lines 455-460):

```js
    } else if (msg.type === 'change') {
      const tab = getTab(store, msg.path);
      if (!tab) return;
      if (msg.path === store.active) show(msg.path);
      else { tab.updated = true; renderTabs(); }
    }
```

with (add the `markRecentInTree` call first, before the tab early-return, so the dot is set even when the changed file has no open tab):

```js
    } else if (msg.type === 'change') {
      markRecentInTree(msg.path);
      const tab = getTab(store, msg.path);
      if (!tab) return;
      if (msg.path === store.active) show(msg.path);
      else { tab.updated = true; renderTabs(); }
    }
```

- [ ] **Step 5: Add the CSS rule**

In `web/app.css`, append after the `.star` rules (after line 78):

```css
.recent-dot { flex:0 0 auto; width:6px; height:6px; border-radius:50%;
              background:var(--accent); margin-left:6px; }
```

- [ ] **Step 6: Manual verification**

```bash
go build -o reefdoc . && ./reefdoc ./docs
```

Then in the browser:
1. Confirm files edited within the last 24h show an accent dot at the right of their row; older files show none; directories never show one.
2. With the app open, run `touch docs/specs/2026-06-08-recent-dot-design.md` (or edit any visible `.md`) and confirm the dot appears on that row **without** reloading the page.
3. Confirm the dot color matches the theme accent in both light and dark mode (toggle theme).

- [ ] **Step 7: Confirm frontend tests still pass**

Run: `npm test`
Expected: PASS (existing suites plus `recency.test.js`).

- [ ] **Step 8: Commit**

```bash
git add web/app.js web/app.css
git commit -m "feat(web): show recently-updated dot on file tree rows"
```

---

## Self-Review

- **Spec coverage:**
  - Files-only, 24h window → Task 1 (`ModTime`) + Task 2 (`RECENT_MS`/`isRecent`) + Task 3 Step 3.
  - Small accent dot at right edge → Task 3 Steps 2-3, 5.
  - Live via SSE → Task 3 Step 4 (`change`); `tree` events re-render via existing `reloadLevel` (no code needed — noted in Architecture).
  - Dirs not marked → `ModTime` set for files only (Task 1 Step 4); `markRecentInTree` selects `.tree-file` only (Task 3 Step 2).
  - Favorites unmarked → no favorites code touched (deliberate).
  - Tests: Go `ModTime` test (Task 1) + recency unit tests (Task 2) + manual DOM/SSE check (Task 3 Step 6).
- **Placeholder scan:** none — every code step shows full code.
- **Type consistency:** Go field `ModTime int64` / JSON `modTime` matches `node.modTime` read in `isRecent(node.modTime)`. Helper names `makeRecentDot`, `markRecentInTree`, `isRecent`, class `.recent-dot` used consistently across Tasks 2-3.
