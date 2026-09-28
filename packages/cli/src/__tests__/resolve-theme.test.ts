import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveTheme } from "../commands/init/scaffold.ts";
import type { WizardAnswers } from "../wizard/answers.ts";

/**
 * Which source seeds a new design's theme when the scan found several. A
 * DESIGN.md is a design system someone wrote down, so it leads; the answer to
 * the wizard's offer (or `--no-design-md`) is what can send it back to the
 * stylesheet.
 */

const DESIGN_MD = `---
name: Paws & Paths
colors:
  background: "#f9f9ff"
  primary: "#855300"
---
`;

let app: string;
beforeEach(async () => {
  app = await mkdtemp(join(tmpdir(), "velloo-resolve-theme-"));
  await writeFile(join(app, "DESIGN.md"), DESIGN_MD, "utf8");
  await writeFile(
    join(app, "globals.css"),
    '@import "tailwindcss";\n:root{--primary: oklch(0.6 0.2 25);}\n',
    "utf8",
  );
});
afterEach(async () => {
  await rm(app, { recursive: true, force: true });
});

function answers(overrides: Partial<WizardAnswers> = {}): WizardAnswers {
  return {
    appRoot: app,
    scanRoot: app,
    folder: join(app, "velloo"),
    library: "shadcn-upstream",
    source: "binary",
    componentsRelative: "components/ui",
    initialContent: "redesign-screen",
    detected: {
      shadcn: true,
      tailwindMajor: 4,
      globalsCssPath: join(app, "globals.css"),
      designMdPath: join(app, "DESIGN.md"),
    },
    ...overrides,
  };
}

describe("resolveTheme", () => {
  test("a DESIGN.md leads, and comes back as the file to follow", () => {
    const r = resolveTheme(answers());
    expect(JSON.stringify(r.theme.colors.primary)).toContain("#855300");
    expect(r.designMd?.path).toBe(join(app, "DESIGN.md"));
    expect(r.designMd?.name).toBe("Paws & Paths");
    expect(r.designMd?.coverage.semantic).toBeGreaterThan(0);
  });

  test("roles the DESIGN.md does not name keep the stylesheet's, not the preset's", async () => {
    await writeFile(
      join(app, "globals.css"),
      '@import "tailwindcss";\n:root{--primary: oklch(0.6 0.2 25); --secondary: oklch(0.97 0.01 250); --accent: oklch(0.96 0.02 80);}\n',
      "utf8",
    );
    const r = resolveTheme(answers());
    expect(JSON.stringify(r.theme.colors.primary)).toContain("#855300");
    expect(JSON.stringify(r.theme.colors.secondary)).toContain("oklch(0.97 0.01 250)");
    expect(JSON.stringify(r.theme.colors.accent)).toContain("oklch(0.96 0.02 80)");
  });

  test("declining it takes the stylesheet, and follows nothing", () => {
    const r = resolveTheme(answers({ useDesignMd: false }));
    expect(JSON.stringify(r.theme.colors.primary)).toContain("oklch(0.6 0.2 25)");
    expect(r.importedFrom).toBe(join(app, "globals.css"));
    expect(r.designMd).toBeUndefined();
  });

  test("a DESIGN.md with nothing to map falls through to the stylesheet", async () => {
    await writeFile(join(app, "DESIGN.md"), "# Acme\n\n## Overview\n\nCalm.\n", "utf8");
    const r = resolveTheme(answers());
    expect(r.importedFrom).toBe(join(app, "globals.css"));
    expect(r.designMd).toBeUndefined();
  });

  test("no detection ⇒ the preset", () => {
    const r = resolveTheme(answers({ detected: undefined }));
    expect(r.importedFrom).toBeUndefined();
    expect(r.designMd).toBeUndefined();
  });
});
