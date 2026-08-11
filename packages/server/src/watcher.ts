import { type FSWatcher, watch } from "node:fs";
import { join, relative, sep } from "node:path";

export type WatchEvent = { type: "page-changed"; pageId: string } | { type: "theme-changed" };

export interface Watcher {
  close(): void;
}

/**
 * Watch a design folder. Emits debounced events for changes under
 * `pages/` (page-changed) and `theme/` (theme-changed). Other paths are
 * ignored.
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

  function classify(filename: string | null): WatchEvent | null {
    if (!filename) return null;
    const parts = filename.split(sep);
    if (parts[0] === "pages" && parts[1] && parts[1].endsWith(".json")) {
      const pageId = parts[1].slice(0, -".json".length);
      return { type: "page-changed", pageId };
    }
    if (parts[0] === "theme" && parts[1] && parts[1].endsWith(".json")) {
      return { type: "theme-changed" };
    }
    return null;
  }

  // node:fs watch with recursive: true is supported on macOS/Windows; on Linux
  // we'd need per-directory watchers. For now we attach to pages/ and theme/
  // explicitly so this works cross-platform without recursive support.
  for (const sub of ["pages", "theme"]) {
    try {
      const w = watch(join(root, sub), (_eventType, filename) => {
        if (!filename) return;
        const rel = `${sub}${sep}${filename}`;
        const ev = classify(rel);
        if (ev) schedule(rel, ev);
      });
      watchers.push(w);
    } catch {
      // Subdirectory may not exist yet (e.g. theme/); ignore.
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

// helper used in tests to compute relative paths consistently
export function _relForTesting(root: string, abs: string): string {
  return relative(root, abs);
}
