import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyWatchPath, type WatchEvent, type Watcher, watchDesignFolder } from "../watcher.ts";

describe("classifyWatchPath", () => {
  test("maps each watched subdir to its event", () => {
    expect(classifyWatchPath("screens/landing.json")).toEqual({
      type: "screen-changed",
      screenId: "landing",
    });
    expect(classifyWatchPath("screens/landing.annotations.json")).toEqual({
      type: "annotations-changed",
      screenId: "landing",
    });
    expect(classifyWatchPath("boards/main.json")).toEqual({
      type: "board-changed",
      boardId: "main",
    });
    expect(classifyWatchPath("boards/main.notes.json")).toEqual({
      type: "notes-changed",
      boardId: "main",
    });
    expect(classifyWatchPath("theme/default.json")).toEqual({ type: "theme-changed" });
    expect(classifyWatchPath("snippets/feature-card.json")).toEqual({
      type: "snippet-changed",
      snippetId: "feature-card",
    });
  });

  test("ignores temp files, dotted stems, and unknown paths", () => {
    // writeJsonAtomic writes <name>.json.<rand>.tmp then renames.
    expect(classifyWatchPath("screens/landing.json.abc123.tmp")).toBeNull();
    expect(classifyWatchPath("screens/landing.draft.json")).toBeNull();
    expect(classifyWatchPath("boards/main.backup.json")).toBeNull();
    expect(classifyWatchPath("screens/notes.txt")).toBeNull();
    expect(classifyWatchPath("assets/logo.svg")).toBeNull();
    expect(classifyWatchPath(null)).toBeNull();
    expect(classifyWatchPath("screens")).toBeNull();
  });
});

describe("watchDesignFolder", () => {
  let tmp: string;
  let watcher: Watcher | null = null;

  beforeEach(async () => {
    tmp = join(tmpdir(), `velloo-watch-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    for (const sub of ["screens", "boards", "theme", "snippets"]) {
      await mkdir(join(tmp, sub), { recursive: true });
    }
  });

  afterEach(async () => {
    watcher?.close();
    watcher = null;
    await rm(tmp, { recursive: true, force: true });
  });

  function collectEvents(debounceMs: number): WatchEvent[] {
    const events: WatchEvent[] = [];
    watcher = watchDesignFolder(tmp, (e) => events.push(e), debounceMs);
    return events;
  }

  async function until(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
    const start = Date.now();
    while (!predicate()) {
      if (Date.now() - start > timeoutMs) return;
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  test("fires one debounced event per changed file", async () => {
    const events = collectEvents(30);
    await writeFile(join(tmp, "screens", "landing.json"), "{}", "utf8");
    await until(() => events.length > 0);
    expect(events).toContainEqual({ type: "screen-changed", screenId: "landing" });
  });

  test("rapid consecutive writes to one file collapse into one event", async () => {
    const events = collectEvents(150);
    const path = join(tmp, "screens", "landing.json");
    // Let fs.watch actually start delivering events before writing — on macOS
    // the kernel watch needs a beat to warm up after watch() returns, and a
    // synchronous burst would otherwise race ahead of it (zero events).
    await new Promise((r) => setTimeout(r, 80));
    // Synchronous back-to-back writes: the event loop does not turn between
    // them, so the watcher's debounce timer cannot fire mid-burst and split the
    // writes into separate events. (With awaited writes the loop yields between
    // each, letting a tight debounce fire early — the source of the flake.) The
    // 150ms window then comfortably absorbs the OS's fs-event delivery spread.
    writeFileSync(path, "{}", "utf8");
    writeFileSync(path, '{"x":1}', "utf8");
    writeFileSync(path, '{"x":2}', "utf8");
    await until(() => events.length > 0);
    // Wait well past the debounce window so a (spurious) second event would land.
    await new Promise((r) => setTimeout(r, 400));
    const screenEvents = events.filter((e) => e.type === "screen-changed");
    expect(screenEvents.length).toBe(1);
  });
});
