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
    // Bun's metafile hands back `/C:/…`; a watcher says `C:\…`. Read naively,
    // the leading slash means "root of the current drive", so a checkout on D:
    // turns the first into `D:\C:\…` — a path that matches nothing.
    expect(pathKey("/C:/Users/x/app.tsx")).toBe(pathKey("C:/Users/x/app.tsx"));
    expect(pathKey("/C:/Users/x/app.tsx")).not.toContain("D:");
    expect(pathKey("/C:/Users/x/app.tsx").toLowerCase()).toContain("c:/users/x/app.tsx");
    if (process.platform === "win32") {
      // The forms actually seen: a backslash lead, and a doubled separator.
      expect(pathKey("\\C:\\Users\\x\\app.tsx")).toBe(pathKey("C:\\Users\\x\\app.tsx"));
      expect(pathKey("//C:/Users/x/app.tsx")).toBe(pathKey("C:/Users/x/app.tsx"));
      expect(pathKey("/C:/Users/x/app.tsx")).not.toContain("d:");
      // Already corrupted upstream: the bundler's metafile stores the joined
      // form, so the key has to undo it rather than merely avoid causing it.
      expect(pathKey("D:/C:/Users/x/app.tsx")).toBe(pathKey("C:/Users/x/app.tsx"));
      expect(pathKey("D:\\C:\\Users\\x\\app.tsx")).toBe(pathKey("C:/Users/x/app.tsx"));
      // The form it actually arrives in: a relative climb across drives.
      expect(pathKey("../../../C:/Users/x/app.tsx")).toBe(pathKey("C:/Users/x/app.tsx"));
      // A path with no inner drive letter is left exactly as it resolved.
      expect(pathKey("D:/a/velloo/app.tsx")).toBe("d:/a/velloo/app.tsx");
    }
  });
});
