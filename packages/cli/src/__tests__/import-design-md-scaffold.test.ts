import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importThemeFromDesignMd } from "../scaffold/import-design-md.ts";

/**
 * `velloo init` seeds a folder's theme from a repo's DESIGN.md before a design
 * folder exists, so it maps through the pure mapper rather than the server's
 * folder-bound import.
 */

let tmp: string;
const write = (name: string, body: string) => writeFile(join(tmp, name), body, "utf8");

beforeEach(async () => {
  tmp = join(
    tmpdir(),
    `velloo-designmd-scaffold-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(tmp, { recursive: true });
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const MATERIAL = `---
name: Paws & Paths
colors:
  background: "#f9f9ff"
  on-background: "#151c27"
  primary: "#855300"
  on-primary: "#ffffff"
  outline: "#867461"
  error: "#ba1a1a"
---

## Brand & Style

Optimistic, trustworthy, active.
`;

describe("importThemeFromDesignMd", () => {
  test("maps Material 3 role names onto the preset theme", async () => {
    await write("DESIGN.md", MATERIAL);
    const r = importThemeFromDesignMd(join(tmp, "DESIGN.md"));
    expect(r).not.toBeNull();
    expect(r?.designSystem).toBe("Paws & Paths");
    expect(r?.theme.colors.background).toBe("#f9f9ff");
    expect(r?.theme.colors.border).toBe("#867461");
    expect(r?.theme.colors.destructive).toMatchObject({ DEFAULT: "#ba1a1a" });
    expect(r?.coverage.semantic).toBeGreaterThan(5);
  });

  test("reports where it read from, which is what init records", async () => {
    // Init stores this path in the config; it never copies the prose.
    await write("DESIGN.md", MATERIAL);
    expect(importThemeFromDesignMd(join(tmp, "DESIGN.md"))?.importedFrom).toBe(
      join(tmp, "DESIGN.md"),
    );
  });

  test("keeps the chosen preset for roles the file does not name", async () => {
    await write("DESIGN.md", MATERIAL);
    const zinc = importThemeFromDesignMd(join(tmp, "DESIGN.md"), "zinc");
    // The file names no secondary; the preset's must survive rather than
    // being blanked by an import that only had some of the roles.
    expect(zinc?.theme.colors.secondary).toBeTruthy();
  });

  test("declines a file that reaches no semantic slot, so init falls back", async () => {
    // Colors with none of the roles would give the canvas an app's hexes and
    // none of its structure — the preset is the better starting point.
    await write("DESIGN.md", `---\nname: Opaque\ncolors:\n  smtc-page-a: "#112233"\n---\n`);
    expect(importThemeFromDesignMd(join(tmp, "DESIGN.md"))).toBeNull();
  });

  test("declines a file with no frontmatter", async () => {
    await write("DESIGN.md", "# Design\n\nWe use a queue.\n");
    expect(importThemeFromDesignMd(join(tmp, "DESIGN.md"))).toBeNull();
  });

  test("declines a path that does not exist", () => {
    expect(importThemeFromDesignMd(join(tmp, "nope.md"))).toBeNull();
  });
});
