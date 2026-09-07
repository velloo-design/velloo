/**
 * Where you were: the board this browser last had open, and the camera it was
 * looking through on each board. Reopening the canvas resumes both, so a
 * reload lands on the same work instead of snapping back to the first board
 * at fit-to-content.
 *
 * Per browser, like every other canvas preference — the design folder is
 * shared, but "where I was" is not. Nothing here is load-bearing: every read
 * validates and returns null on anything unexpected, and every write swallows
 * quota / private-mode failures.
 */

const LAST_BOARD_KEY = "velloo:lastBoard";
const VIEW_PREFIX = "velloo:boardView:";

export interface BoardView {
  pan: { x: number; y: number };
  zoom: number;
}

/**
 * The board id to reopen, or null. Callers must check it still exists — it
 * may name a board deleted since, or (when a folder inherits another's port)
 * one that was never in this folder.
 */
export function readLastBoard(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(LAST_BOARD_KEY) || null;
  } catch {
    return null;
  }
}

export function writeLastBoard(boardId: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LAST_BOARD_KEY, boardId);
  } catch {
    // See the module comment: resuming is a convenience, not a critical path.
  }
}

/**
 * This board's last pan + zoom. Null when we've never stored one (or the
 * stored value is corrupt) so the caller falls back to fit-to-content.
 */
export function readBoardView(boardId: string): BoardView | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(VIEW_PREFIX + boardId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BoardView>;
    const zoom =
      typeof parsed.zoom === "number" && Number.isFinite(parsed.zoom) ? parsed.zoom : null;
    const px =
      parsed.pan && typeof parsed.pan.x === "number" && Number.isFinite(parsed.pan.x)
        ? parsed.pan.x
        : null;
    const py =
      parsed.pan && typeof parsed.pan.y === "number" && Number.isFinite(parsed.pan.y)
        ? parsed.pan.y
        : null;
    if (zoom === null || px === null || py === null) return null;
    return { pan: { x: px, y: py }, zoom };
  } catch {
    return null;
  }
}

export function writeBoardView(boardId: string, view: BoardView): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(VIEW_PREFIX + boardId, JSON.stringify(view));
  } catch {
    // See the module comment.
  }
}

/**
 * Forget every board's camera and the board to reopen — the board half of
 * "reset canvas preferences". The view keys are per board id, so they're
 * found by prefix rather than listed.
 */
export function clearBoardMemory(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(LAST_BOARD_KEY);
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(VIEW_PREFIX)) stale.push(key);
    }
    for (const key of stale) localStorage.removeItem(key);
  } catch {
    // See the module comment.
  }
}
