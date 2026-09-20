import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { pathKey } from "../bundle-core.ts";

/**
 * Selective invalidation compares a watcher's path against a bundler's build
 * input. On Windows those are routinely different strings for the same file,
 * and a mismatch doesn't fail loudly — it just stops invalidating, so the
 * canvas keeps serving a bundle compiled from source that has since changed.
 */
describe("pathKey", () => {
  test("one spelling for the same file", () => {
    const here = resolve("packages/server/src/live/bundle-core.ts");
    expect(pathKey(here)).toBe(pathKey("packages/server/src/live/bundle-core.ts"));
    expect(pathKey(here)).toBe(pathKey(`${here}`.replace(/\//g, "/")));
    expect(pathKey(here)).not.toBe(pathKey(resolve("packages/server/src/live/canvas-bundle.ts")));
  });

  test("a drive-lettered path keeps its drive, however it arrives", () => {
    // Bun's metafile hands back `/D:/…` on Windows; a watcher says `D:\…`.
    // On POSIX these are ordinary relative names, and must still agree.
    expect(pathKey("/D:/a/app.tsx")).toBe(pathKey("D:/a/app.tsx"));
  });
});
