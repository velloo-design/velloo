import { existsSync, type FSWatcher, readdirSync, statSync, watch } from "node:fs";
import { join, sep } from "node:path";
import type { WatchEvent } from "@velloo/protocol";

/**
 * The event union is the canvas's wire contract, so it is declared in
 * `@velloo/protocol` and re-exported here for the watcher's own callers.
 */
export type { WatchEvent } from "@velloo/protocol";

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
  // fs.watch reports native separators; accept either so callers need not care.
  const parts = filename.split(/[\\/]/);
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
  if (parts[0] === "theme" && parts[1] && /\.(json|css)$/.test(parts[1])) {
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
  let fingerprint = designFingerprint(root);

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
        if (ev) {
          // Keep the polling fallback in step with native events so it does not
          // rediscover the same write after the debounce has already fired.
          fingerprint = designFingerprint(root);
          schedule(rel, ev);
        }
      });
      watchers.push(w);
    } catch {
      // subdir may not exist yet; ignore
    }
  }

  const poll = setInterval(() => {
    const next = designFingerprint(root);
    const paths = new Set([...fingerprint.keys(), ...next.keys()]);
    for (const path of paths) {
      if (fingerprint.get(path) === next.get(path)) continue;
      const event = classifyWatchPath(path);
      if (event) schedule(path, event);
    }
    fingerprint = next;
  }, 250);

  return {
    close() {
      for (const w of watchers) w.close();
      clearInterval(poll);
      for (const t of pending.values()) clearTimeout(t);
      pending.clear();
    },
  };
}

function designFingerprint(root: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const sub of ["screens", "boards", "theme", "snippets"]) {
    const dir = join(root, sub);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      try {
        const stat = statSync(path);
        if (stat.isFile()) out.set(`${sub}${sep}${name}`, `${stat.mtimeMs}:${stat.size}`);
      } catch {
        // Atomic rename raced the scan; the next poll observes the final file.
      }
    }
  }
  return out;
}

/**
 * Watch host component trees, including a directory that does not exist yet
 * (a planned `components/ui` the user has not run `shadcn add` into). The
 * watcher arms on the target itself and never on a walked-up ancestor: the
 * nearest existing parent of a planned component directory is usually the whole
 * app, and a recursive watch there would cover `node_modules` and build output.
 * A not-yet-created target is carried by the fingerprint poll below, which arms
 * the real watcher as soon as the directory appears.
 */
export function watchSourcePaths(
  paths: readonly string[],
  onChange: () => void,
  debounceMs = 80,
): Watcher {
  const targets = [...new Set(paths)];
  const watchers = new Map<string, FSWatcher>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      onChange();
    }, debounceMs);
  };

  const arm = (target: string): void => {
    if (watchers.has(target)) return;
    try {
      if (!statSync(target).isDirectory()) return;
      watchers.set(
        target,
        watch(target, { recursive: true }, (_event, filename) => {
          if (filename) schedule();
        }),
      );
    } catch {
      // Missing (armed by a later poll) or a platform without recursive watch —
      // the poll still refreshes the canvas, just at poll granularity.
    }
  };
  const disarm = (target: string): void => {
    watchers.get(target)?.close();
    watchers.delete(target);
  };
  for (const target of targets) arm(target);

  // fs.watch is lossy on some filesystems and cannot attach to a directory that
  // does not exist yet. A small fingerprint poll makes planned shadcn installs
  // and editor atomic-renames deterministic without busy scanning.
  let fingerprint = sourceFingerprint(targets);
  const poll = setInterval(() => {
    const next = sourceFingerprint(targets);
    if (next === fingerprint) return;
    fingerprint = next;
    for (const target of targets) {
      if (existsSync(target)) arm(target);
      else disarm(target);
    }
    schedule();
  }, 250);
  return {
    close() {
      for (const watcher of watchers.values()) watcher.close();
      watchers.clear();
      clearInterval(poll);
      if (timer) clearTimeout(timer);
    },
  };
}

function sourceFingerprint(paths: readonly string[]): string {
  const rows: string[] = [];
  const visit = (path: string): void => {
    try {
      if (!existsSync(path)) {
        rows.push(`${path}:missing`);
        return;
      }
      const stat = statSync(path);
      rows.push(`${path}:${stat.mtimeMs}:${stat.size}`);
      if (!stat.isDirectory()) return;
      for (const name of readdirSync(path).sort()) visit(join(path, name));
    } catch {
      // An editor's atomic rename raced the traversal. Record the transient
      // state; the next poll observes the final file and schedules a refresh.
      rows.push(`${path}:raced`);
    }
  };
  for (const path of paths) visit(path);
  return rows.join("|");
}
