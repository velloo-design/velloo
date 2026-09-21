import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { unwrap } from "@velloo/result";
import { testContext } from "../../testing/design-folder.ts";
import { importThemeDesignMd, type ThemeContext } from "../index.ts";

/**
 * Material 3 role names, which is what every example in google-labs-code/design.md
 * actually ships — not shadcn's vocabulary. Trimmed from `examples/paws-and-paths`.
 */
const M3_DESIGN_MD = `---
name: Paws & Paths
version: alpha
colors:
  surface: "#f9f9ff"
  surface-container: "#e7eefe"
  surface-container-high: "#e2e8f8"
  surface-container-lowest: "#ffffff"
  surface-variant: "#dce2f3"
  on-surface: "#151c27"
  on-surface-variant: "#534434"
  outline: "#867461"
  outline-variant: "#d8c3ad"
  primary: "#855300"
  on-primary: "#ffffff"
  secondary: "#0058be"
  on-secondary: "#ffffff"
  tertiary: "#00658b"
  on-tertiary: "#ffffff"
  error: "#ba1a1a"
  on-error: "#ffffff"
  background: "#f9f9ff"
  on-background: "#151c27"
typography:
  display:
    fontFamily: Inter
    fontSize: 44px
    fontWeight: "800"
    lineHeight: 52px
    letterSpacing: -0.02em
  body-md:
    fontFamily: Inter
    fontSize: 16px
    lineHeight: 24px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  lg: 1rem
  full: 9999px
spacing:
  xs: 4px
  md: 24px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
---

## Brand & Style

Optimistic, trustworthy, active.

## Colors

The primary is a warm amber.

## Do's and Don'ts

- Do keep the surface calm.
`;

async function ctxFor(): Promise<{
  ctx: ThemeContext;
  root: string;
  cleanup: () => Promise<void>;
}> {
  const t = await testContext({ label: "design-md" });
  return { ctx: t.ctx as ThemeContext, root: t.root, cleanup: t.cleanup };
}

describe("importThemeDesignMd — Material 3 vocabulary", () => {
  test("aliases M3 role names onto velloo's semantic slots", async () => {
    const { ctx, cleanup } = await ctxFor();
    try {
      const r = unwrap(await importThemeDesignMd(ctx, M3_DESIGN_MD));
      const c = r.theme.colors;
      expect(c.background).toBe("#f9f9ff");
      expect(c.foreground).toBe("#151c27");
      expect(c.primary).toEqual({ DEFAULT: "#855300", foreground: "#ffffff" });
      expect(c.secondary).toEqual({ DEFAULT: "#0058be", foreground: "#ffffff" });
      expect(c.accent).toEqual({ DEFAULT: "#00658b", foreground: "#ffffff" });
      expect(c.destructive).toEqual({ DEFAULT: "#ba1a1a", foreground: "#ffffff" });
      expect(c.muted).toEqual({ DEFAULT: "#dce2f3", foreground: "#534434" });
      expect(c.card).toEqual({ DEFAULT: "#e7eefe", foreground: "#151c27" });
      expect(c.popover).toEqual({ DEFAULT: "#e2e8f8", foreground: "#151c27" });
      expect(c.border).toBe("#867461");
      expect(c.input).toBe("#d8c3ad");
      expect(c.ring).toBe("#855300");
    } finally {
      await cleanup();
    }
  });

  test("reports full semantic coverage and which slots were aliased", async () => {
    const { ctx, cleanup } = await ctxFor();
    try {
      const r = unwrap(await importThemeDesignMd(ctx, M3_DESIGN_MD));
      expect(r.coverage.semantic).toBe(r.coverage.semanticTotal);
      expect(r.coverage.unmapped).toEqual([]);
      // The two names velloo shares with M3 are direct; the rest are aliased.
      expect(r.coverage.aliased.map((a) => a.from)).toContain("outline");
      expect(r.coverage.aliased.map((a) => a.from)).toContain("on-background");
      expect(r.coverage.aliased).not.toContainEqual({ from: "primary", to: "colors.primary" });
      expect(r.designSystem).toBe("Paws & Paths");
      expect(r.warnings).not.toContain(expect.stringContaining("none of the"));
    } finally {
      await cleanup();
    }
  });

  test("keeps every color reachable as a palette passthrough", async () => {
    const { ctx, cleanup } = await ctxFor();
    try {
      const r = unwrap(await importThemeDesignMd(ctx, M3_DESIGN_MD));
      // `bg-surface-container-lowest` should resolve on the canvas even though
      // no semantic slot claimed it.
      expect(r.theme.palette?.["surface-container-lowest"]).toBe("#ffffff");
      expect(r.theme.palette?.["on-surface"]).toBe("#151c27");
      // A name that IS a velloo slot stays out of the passthrough.
      expect(r.theme.palette?.primary).toBeUndefined();
      expect(r.coverage.palette).toBeGreaterThan(0);
    } finally {
      await cleanup();
    }
  });
});

describe("importThemeDesignMd — velloo-native vocabulary wins", () => {
  const SHADCN_NAMED = `---
name: Direct
colors:
  background: "#ffffff"
  foreground: "#111111"
  surface: "#ff0000"
  on-surface: "#00ff00"
  primary: "#0000ff"
  primary-foreground: "#fefefe"
  muted: "#eeeeee"
---
`;

  test("a direct slot name beats the Material alias for the same slot", async () => {
    const { ctx, cleanup } = await ctxFor();
    try {
      const r = unwrap(await importThemeDesignMd(ctx, SHADCN_NAMED));
      // `surface`/`on-surface` would otherwise claim background/foreground.
      expect(r.theme.colors.background).toBe("#ffffff");
      expect(r.theme.colors.foreground).toBe("#111111");
      expect(r.theme.colors.primary).toEqual({ DEFAULT: "#0000ff", foreground: "#fefefe" });
      // A pair slot given a bare color keeps the pair shape, foreground unset.
      expect(r.theme.colors.muted).toEqual({ DEFAULT: "#eeeeee" });
    } finally {
      await cleanup();
    }
  });
});

describe("importThemeDesignMd — non-color sections", () => {
  test("maps rounded levels, routing DEFAULT to the --radius anchor", async () => {
    const { ctx, cleanup } = await ctxFor();
    try {
      const r = unwrap(await importThemeDesignMd(ctx, M3_DESIGN_MD));
      expect(r.theme.radius.sm).toBe("0.25rem");
      expect(r.theme.radius.lg).toBe("1rem");
      expect(r.theme.radius.full).toBe("9999px");
      // `DEFAULT` has no velloo name; it becomes `md`, which emit_theme writes
      // as `--radius`, because the file did not also name `md`.
      expect(r.theme.radius.md).toBe("0.5rem");
    } finally {
      await cleanup();
    }
  });

  test("an explicit md wins over DEFAULT, and unknown levels warn", async () => {
    const { ctx, cleanup } = await ctxFor();
    try {
      const src = `---\nname: R\nrounded:\n  DEFAULT: 0.5rem\n  md: 0.75rem\n  pill: 100px\n---\n`;
      const r = unwrap(await importThemeDesignMd(ctx, src));
      expect(r.theme.radius.md).toBe("0.75rem");
      expect(r.warnings.join(" ")).toContain('"pill"');
      expect(r.warnings.join(" ")).toContain("no velloo radius slot");
      // DEFAULT is a known level that `md` superseded — a different message
      // from "velloo has no such level".
      expect(r.warnings.join(" ")).toContain("rounded.DEFAULT (0.5rem) was dropped");
    } finally {
      await cleanup();
    }
  });

  test("copies the spacing scale verbatim", async () => {
    const { ctx, cleanup } = await ctxFor();
    try {
      const r = unwrap(await importThemeDesignMd(ctx, M3_DESIGN_MD));
      expect(r.theme.spacing.xs).toBe("4px");
      expect(r.theme.spacing.md).toBe("24px");
    } finally {
      await cleanup();
    }
  });

  test("derives font roles, a webfont load, and the body rhythm", async () => {
    const { ctx, cleanup } = await ctxFor();
    try {
      const r = unwrap(await importThemeDesignMd(ctx, M3_DESIGN_MD));
      expect(r.theme.typography.fontFamily?.sans).toContain("Inter");
      // Inter is in velloo's catalog, so the import also arranges to LOAD it —
      // without this the family name resolves to nothing on the canvas.
      expect(r.theme.typography.googleFonts?.some((f) => f.startsWith("Inter"))).toBe(true);
      const typeset = r.theme.typography.typesets?.default;
      expect(typeset?.fontBody).toBe("sans");
      // display + body share a family, so no separate `display` role is coined.
      expect(typeset?.fontHeading).toBe("sans");
      expect(r.theme.typography.fontFamily?.display).toBeUndefined();
      expect(typeset?.size).toBe("16px");
      expect(typeset?.leading).toBe(1.5); // 24px / 16px
    } finally {
      await cleanup();
    }
  });

  test("coins a display role when headings use a different family", async () => {
    const { ctx, cleanup } = await ctxFor();
    try {
      const src = `---
name: Two
typography:
  headline-lg:
    fontFamily: Fraunces
    fontSize: 32px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    lineHeight: 1.6
---
`;
      const r = unwrap(await importThemeDesignMd(ctx, src));
      expect(r.theme.typography.fontFamily?.display).toContain("Fraunces");
      expect(r.theme.typography.fontFamily?.sans).toContain("Inter");
      expect(r.theme.typography.typesets?.default?.fontHeading).toBe("display");
      expect(r.theme.typography.typesets?.default?.leading).toBe(1.6);
    } finally {
      await cleanup();
    }
  });

  test("warns about a font velloo cannot load", async () => {
    const { ctx, cleanup } = await ctxFor();
    try {
      const src = `---\nname: X\ntypography:\n  body:\n    fontFamily: Totally Made Up Face\n    fontSize: 16px\n---\n`;
      const r = unwrap(await importThemeDesignMd(ctx, src));
      expect(r.warnings.join(" ")).toContain("Totally Made Up Face");
      expect(r.warnings.join(" ")).toContain("no webfont is loaded");
    } finally {
      await cleanup();
    }
  });
});

describe("importThemeDesignMd — what the format carries that velloo does not", () => {
  test("reports components and the typography ladder as dropped, with counts", async () => {
    const { ctx, cleanup } = await ctxFor();
    try {
      const r = unwrap(await importThemeDesignMd(ctx, M3_DESIGN_MD));
      const components = r.dropped.find((d) => d.section === "components");
      expect(components?.count).toBe(1);
      expect(r.dropped.find((d) => d.section === "typography")?.count).toBe(2);
    } finally {
      await cleanup();
    }
  });

  test("captures the prose body without storing it", async () => {
    const { ctx, cleanup } = await ctxFor();
    try {
      const r = unwrap(await importThemeDesignMd(ctx, M3_DESIGN_MD));
      expect(r.prose.sections).toEqual(["Brand & Style", "Colors", "Do's and Don'ts"]);
      expect(r.prose.bytes).toBeGreaterThan(0);
    } finally {
      await cleanup();
    }
  });

  test("resolves {token.path} references before mapping", async () => {
    const { ctx, cleanup } = await ctxFor();
    try {
      const src = `---\nname: Refs\ncolors:\n  brand-600: "#123456"\n  primary: "{colors.brand-600}"\n---\n`;
      const r = unwrap(await importThemeDesignMd(ctx, src));
      expect(r.theme.colors.primary).toEqual({
        DEFAULT: "#123456",
        foreground: "oklch(0.985 0 0)",
      });
    } finally {
      await cleanup();
    }
  });

  test("notes sections the file declares intentionally omitted", async () => {
    const { ctx, cleanup } = await ctxFor();
    try {
      const src = `---\nname: O\ncolors:\n  primary: "#111111"\nomitted:\n  - spacing\n  - section: rounded\n    reason: "no radii in brand book"\n---\n`;
      const r = unwrap(await importThemeDesignMd(ctx, src));
      expect(r.warnings.join(" ")).toContain("intentionally omitted: spacing, rounded");
    } finally {
      await cleanup();
    }
  });
});

describe("importThemeDesignMd — the light/dark axis the spec lacks", () => {
  const DARK = `---
name: Atmospheric Glass
colors:
  background: "#0b1326"
  on-background: "#dae2fd"
  primary: "#ffffff"
  on-primary: "#2f3131"
---
`;

  test("warns when a dark palette is imported as the light one", async () => {
    const { ctx, cleanup } = await ctxFor();
    try {
      const r = unwrap(await importThemeDesignMd(ctx, DARK));
      expect(r.mode).toBe("light");
      expect(r.warnings.join(" ")).toContain("looks like a dark design system");
      expect(r.warnings.join(" ")).toContain('mode: "dark"');
    } finally {
      await cleanup();
    }
  });

  test('mode: "dark" lands the palette in colorsDark and leaves colors alone', async () => {
    const { ctx, cleanup } = await ctxFor();
    try {
      const before = ctx.folder.theme.colors.background;
      const r = unwrap(await importThemeDesignMd(ctx, DARK, { mode: "dark" }));
      expect(r.theme.colors.background).toBe(before);
      expect(r.theme.colorsDark?.background).toBe("#0b1326");
      expect(r.theme.colorsDark?.foreground).toBe("#dae2fd");
      expect(r.theme.paletteDark?.["on-background"]).toBe("#dae2fd");
      expect(r.theme.palette).toBeUndefined();
    } finally {
      await cleanup();
    }
  });
});

describe("importThemeDesignMd — persistence and rejection", () => {
  test("is a dry run by default and persists with apply", async () => {
    const { ctx, root, cleanup } = await ctxFor();
    try {
      const dry = unwrap(await importThemeDesignMd(ctx, M3_DESIGN_MD));
      expect(dry.applied).toBe(false);
      expect(dry.changes.length).toBeGreaterThan(0);
      let onDisk = JSON.parse(await readFile(join(root, "theme", "default.json"), "utf8"));
      expect(onDisk.colors.background).not.toBe("#f9f9ff");

      const applied = unwrap(await importThemeDesignMd(ctx, M3_DESIGN_MD, { apply: true }));
      expect(applied.applied).toBe(true);
      onDisk = JSON.parse(await readFile(join(root, "theme", "default.json"), "utf8"));
      expect(onDisk.colors.background).toBe("#f9f9ff");
    } finally {
      await cleanup();
    }
  });

  test("rejects a file with no frontmatter", async () => {
    const { ctx, cleanup } = await ctxFor();
    try {
      const r = await importThemeDesignMd(ctx, "# Just a readme\n\nNo tokens here.\n");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe("BadRequest");
    } finally {
      await cleanup();
    }
  });

  test("rejects frontmatter with no name", async () => {
    const { ctx, cleanup } = await ctxFor();
    try {
      const r = await importThemeDesignMd(ctx, `---\ncolors:\n  primary: "#fff"\n---\n`);
      expect(r.ok).toBe(false);
      if (!r.ok && r.error.kind === "BadRequest") expect(r.error.message).toContain("`name:`");
    } finally {
      await cleanup();
    }
  });

  test("rejects frontmatter carrying no tokens at all", async () => {
    const { ctx, cleanup } = await ctxFor();
    try {
      const r = await importThemeDesignMd(ctx, `---\nname: Empty\ndescription: nothing\n---\n`);
      expect(r.ok).toBe(false);
      if (!r.ok && r.error.kind === "BadRequest")
        expect(r.error.message).toContain("nothing to import");
    } finally {
      await cleanup();
    }
  });
});

describe("importThemeDesignMd — faces and the radius anchor", () => {
  test("a mono face is detected from the family, not the token's name", async () => {
    const { ctx, cleanup } = await ctxFor();
    try {
      // Real systems name these tokens after the job — `label`, `figure` — and
      // classifying by name alone drops the mono face on the floor.
      const src = `---
name: Console
typography:
  body:
    fontFamily: Space Grotesk
    fontSize: 14px
  label:
    fontFamily: IBM Plex Mono
    fontSize: 10px
  figure:
    fontFamily: IBM Plex Mono
    fontSize: 14px
---
`;
      const r = unwrap(await importThemeDesignMd(ctx, src));
      expect(r.theme.typography.fontFamily?.mono).toContain("IBM Plex Mono");
      expect(r.theme.typography.fontFamily?.sans).toContain("Space Grotesk");
      expect(r.theme.typography.typesets?.default?.fontMono).toBe("mono");
    } finally {
      await cleanup();
    }
  });

  test("a single-radius system sets the --radius anchor, not just a named step", async () => {
    const { ctx, cleanup } = await ctxFor();
    try {
      // "Nothing is rounded" that still renders rounded is the failure this
      // guards: velloo's radius.md is what `--radius` resolves to.
      const r = unwrap(
        await importThemeDesignMd(ctx, `---\nname: Flat\nrounded:\n  none: 0px\n---\n`),
      );
      expect(r.theme.radius.md).toBe("0px");
      expect(r.warnings.join(" ")).toContain("single radius");
    } finally {
      await cleanup();
    }
  });

  test("a multi-step scale with no md says the anchor was left alone", async () => {
    const { ctx, cleanup } = await ctxFor();
    try {
      const r = unwrap(
        await importThemeDesignMd(ctx, `---\nname: S\nrounded:\n  sm: 2px\n  lg: 8px\n---\n`),
      );
      expect(r.theme.radius.sm).toBe("2px");
      expect(r.warnings.join(" ")).toContain("not `md` or `DEFAULT`");
    } finally {
      await cleanup();
    }
  });
});
