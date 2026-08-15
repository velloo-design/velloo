import { type FSWatcher, watch } from "node:fs";
import { join, relative, sep } from "node:path";

export type WatchEvent =
  | { type: "screen-changed"; screenId: string }
  | { type: "board-changed"; boardId: string }
  | { type: "theme-changed" }
  | { type: "snippet-changed"; snippetId: string }
  | { type: "annotations-changed"; screenId: string }
  | { type: "notes-changed"; boardId: string }
  /**
   * `.design/config.json` changed — typically a Sprint-Y
   * `add_extension` / `update_extension` / `remove_extension`
   * mutation. The canvas refreshes its Library tab so new extensions
   * appear without a full page reload.
   */
  | { type: "config-changed" }
  /**
   * A watched file changed but failed to reload into memory
   * (unparseable JSON, schema violation). Emitted by the server's
   * reload pipeline rather than the watcher itself; clients surface it
   * so an on-disk edit is never silently dropped while the canvas
   * keeps rendering stale state.
   */
  | { type: "reload-error"; source: string; message: string };

export interface Watcher {
  close(): void;
}

/**
 * Map a folder-relative path (e.g. "screens/landing.json") to its watch
 * event. Pure — exported for tests. Returns null for paths that should
 * never fire (temp files, unknown subdirs, dotted stems from atomic
 * writes).
 */
export function classifyWatchPath(filename: string | null): WatchEvent | null {
  if (!filename) return null;
  const parts = filename.split(sep);
  if (parts[0] === "screens" && parts[1]) {
    const file = parts[1];
    if (file.endsWith(".annotations.json")) {
      const screenId = file.slice(0, -".annotations.json".length);
      return { type: "annotations-changed", screenId };
    }
    if (file.endsWith(".json")) {
      const stem = file.slice(0, -".json".length);
      if (!stem.includes(".")) return { type: "screen-changed", screenId: stem };
    }
  }
  if (parts[0] === "boards" && parts[1]) {
    const file = parts[1];
    if (file.endsWith(".notes.json")) {
      const boardId = file.slice(0, -".notes.json".length);
      return { type: "notes-changed", boardId };
    }
    if (file.endsWith(".json")) {
      const stem = file.slice(0, -".json".length);
      if (!stem.includes(".")) return { type: "board-changed", boardId: stem };
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

  for (const sub of ["screens", "boards", "theme", "snippets"]) {
    try {
      const w = watch(join(root, sub), (_eventType, filename) => {
        if (!filename) return;
        const rel = `${sub}${sep}${filename}`;
        const ev = classifyWatchPath(rel);
        if (ev) schedule(rel, ev);
      });
      watchers.push(w);
    } catch {
      // subdir may not exist yet; ignore
    }
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
