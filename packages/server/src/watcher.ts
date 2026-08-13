import { type FSWatcher, watch } from "node:fs";
import { join, relative, sep } from "node:path";

export type WatchEvent =
  | { type: "screen-changed"; screenId: string }
  | { type: "board-changed" }
  | { type: "theme-changed" }
  | { type: "snippet-changed"; snippetId: string }
  | { type: "annotations-changed"; screenId: string }
  | { type: "notes-changed" };

export interface Watcher {
  close(): void;
}

/**
 * Watch a design folder. Emits debounced events for changes under
 * `screens/`, `theme/`, `snippets/`, and the top-level `board.json` /
 * `board.notes.json` files.
 */
export function watchDesignFolder(
  root: string,
  onEvent: (e: WatchEvent) => void,
  debounceMs = 50,
): Watcher {
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  const watchers: FSWatcher[] = [];

  function schedule(key: string, ev: WatchEvent): void {
    const prev = pending.get(key);
    if (prev) clearTimeout(prev);
    pending.set(
      key,
      setTimeout(() => {
        pending.delete(key);
        onEvent(ev);
      }, debounceMs),
    );
  }

  function classifySubdir(filename: string | null): WatchEvent | null {
    if (!filename) return null;
    const parts = filename.split(sep);
    if (parts[0] === "screens" && parts[1]) {
      const file = parts[1];
      if (file.endsWith(".annotations.json")) {
        const screenId = file.slice(0, -".annotations.json".length);
        return { type: "annotations-changed", screenId };
      }
      if (file.endsWith(".json") && !file.includes(".")) {
        const screenId = file.slice(0, -".json".length);
        return { type: "screen-changed", screenId };
      }
      // also accept simple `<id>.json` (without `.` in stem) — fallthrough
      if (file.endsWith(".json")) {
        const stem = file.slice(0, -".json".length);
        if (!stem.includes(".")) {
          return { type: "screen-changed", screenId: stem };
        }
      }
    }
    if (parts[0] === "theme" && parts[1] && parts[1].endsWith(".json")) {
      return { type: "theme-changed" };
    }
    if (parts[0] === "snippets" && parts[1] && parts[1].endsWith(".json")) {
      const snippetId = parts[1].slice(0, -".json".length);
      return { type: "snippet-changed", snippetId };
    }
    return null;
  }

  for (const sub of ["screens", "theme", "snippets"]) {
    try {
      const w = watch(join(root, sub), (_eventType, filename) => {
        if (!filename) return;
        const rel = `${sub}${sep}${filename}`;
        const ev = classifySubdir(rel);
        if (ev) schedule(rel, ev);
      });
      watchers.push(w);
    } catch {
      // subdirectory may not exist yet (e.g. snippets/); ignore.
    }
  }

  // Top-level board.json + board.notes.json — watch the root directory.
  try {
    const w = watch(root, (_eventType, filename) => {
      if (!filename) return;
      if (filename === "board.json") schedule("board", { type: "board-changed" });
      else if (filename === "board.notes.json") schedule("notes", { type: "notes-changed" });
    });
    watchers.push(w);
  } catch {
    // ignore — folder root must exist or we wouldn't be here
  }

  return {
    close() {
      for (const w of watchers) w.close();
      for (const t of pending.values()) clearTimeout(t);
      pending.clear();
    },
  };
}

export function _relForTesting(root: string, abs: string): string {
  return relative(root, abs);
}
