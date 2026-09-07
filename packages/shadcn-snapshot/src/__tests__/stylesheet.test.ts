import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("the entry stylesheet", () => {
  /**
   * Upstream's sources reference `cn-*` semantic classes that live in the
   * shadcn.com app's own globals.css and are not distributed with the registry
   * item — the same leak that puts `IconPlaceholder` in the source. A pull can
   * therefore add a class nothing defines, and the component renders inert
   * (no frosted menu surface, no heading face, no focus ring on the calendar's
   * invisible month select) rather than failing. The 2026.09 pull did exactly
   * that with four of them.
   */
  test("defines every cn-* class the vendored components reference", async () => {
    const entry = await readFile(join(src, "tailwind-entry.css"), "utf8");
    const defined = new Set(
      [...entry.matchAll(/@utility (cn-[a-z-]+)/g)].map((m) => m[1] as string),
    );

    const uiDir = join(src, "components", "ui");
    const referenced = new Set<string>();
    for (const file of (await readdir(uiDir)).filter((f) => f.endsWith(".tsx"))) {
      // Skip the provenance header, whose URL contains "shadcn-ui".
      const body = (await readFile(join(uiDir, file), "utf8")).replace(/^\/\/.*$/gm, "");
      for (const match of body.matchAll(/\bcn-[a-z-]+/g)) referenced.add(match[0]);
    }

    expect([...referenced].filter((name) => !defined.has(name))).toEqual([]);
  });
});
