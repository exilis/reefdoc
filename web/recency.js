// Pure recency check: is a unix-millis modification time within the recent
// window? `now` is injectable so tests are deterministic; it defaults to the
// current time. A zero/undefined modTime (no info available) is never recent.
export const RECENT_MS = 24 * 60 * 60 * 1000; // 24 hours

export function isRecent(modTime, now = Date.now()) {
  return !!modTime && now - modTime < RECENT_MS;
}
