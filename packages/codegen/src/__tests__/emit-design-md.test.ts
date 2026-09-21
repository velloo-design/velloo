import { describe, expect, test } from "bun:test";
import type { Theme } from "@velloo/schema";
import { emitDesignMdContents } from "../emit-theme/design-md.ts";

const theme = (overrides: Partial<Theme> = {}): Theme =>
  ({
    name: "default",
    colors: {
      background: "#ffffff",
      foreground: "#111111",
      primary: { DEFAULT: "#4f46e5", foreground: "#ffffff" },
      border: "#e5e5e5",
    },
    typography: {
      fontFamily: { sans: '"Inter", ui-sans-serif, system-ui, sans-serif' },
      typesets: { default: { size: "16px", leading: 1.5, fontBody: "sans" } },
    },
    spacing: { sm: "8px", md: "16px" },
    radius: { md: "0.5rem", full: "9999px" },
    ...overrides,
  }) as Theme;

const frontmatter = (contents: string): string => contents.slice(0, contents.indexOf("\n---", 4));

describe("emitDesignMdContents — frontmatter", () => {
  test("opens with the spec's required fields", () => {
    const { contents } = emitDesignMdContents(theme(), { name: "Acme" });
    expect(contents.startsWith("---\nversion: alpha\nname: Acme\n")).toBe(true);
  });

  test("falls back to the theme's name only when no design name is given", () => {
    // `theme.name` is the named-theme key the canvas edits through, not the
    // design system's name — so callers pass the folder's name.
    expect(frontmatter(emitDesignMdContents(theme()).contents)).toContain("name: default");
    expect(frontmatter(emitDesignMdContents(theme(), { name: "Acme" }).contents)).toContain(
      "name: Acme",
    );
  });

  test("writes color pairs as name + name-foreground", () => {
    const fm = frontmatter(emitDesignMdContents(theme()).contents);
    expect(fm).toContain('primary: "#4f46e5"');
    expect(fm).toContain('primary-foreground: "#ffffff"');
  });

  test("declares components omitted, with a reason", () => {
    const fm = frontmatter(emitDesignMdContents(theme()).contents);
    expect(fm).toContain("omitted:");
    expect(fm).toContain("- section: components");
    expect(fm).toContain("reason:");
  });

  test("emits the derived ladder, not just the three rhythm controls", () => {
    const fm = frontmatter(emitDesignMdContents(theme()).contents);
    for (const role of ["h1:", "h2:", "h6:", "body:", "lead:", "small:", "caption:"]) {
      expect(fm).toContain(`  ${role}`);
    }
    // 16px base × the h1 ratio (2.5).
    expect(fm).toContain("fontSize: 40px");
    expect(fm).toContain("fontSize: 16px");
  });

  test("carries the palette passthrough so the product's own names survive", () => {
    const fm = frontmatter(
      emitDesignMdContents(theme({ palette: { "brand-600": "#123456" } })).contents,
    );
    expect(fm).toContain('brand-600: "#123456"');
  });
});

describe("emitDesignMdContents — YAML safety", () => {
  test("quotes a font stack, which starts with a quote character", () => {
    // A bare `"Inter", ui-sans-serif` parses as a quoted scalar followed by
    // garbage — the finding Google's own linter reported against an earlier
    // denylist-based quoting rule.
    const fm = frontmatter(emitDesignMdContents(theme()).contents);
    expect(fm).toContain('fontFamily: "\\"Inter\\", ui-sans-serif, system-ui, sans-serif"');
  });

  test("quotes hex colors, which would otherwise open a YAML comment", () => {
    expect(frontmatter(emitDesignMdContents(theme()).contents)).toContain('background: "#ffffff"');
  });

  test("quotes a font weight so it stays a string", () => {
    expect(frontmatter(emitDesignMdContents(theme()).contents)).toContain('fontWeight: "400"');
  });

  test("leaves a plain role name bare", () => {
    const fm = frontmatter(emitDesignMdContents(theme({ spacing: { gutter: "16px" } })).contents);
    expect(fm).toContain("  gutter:");
  });
});

describe("emitDesignMdContents — what the format cannot hold", () => {
  test("drops a spacing value whose unit the spec rejects, and says so", () => {
    const { contents, warnings } = emitDesignMdContents(
      theme({ spacing: { ok: "8px", bad: "50%" } }),
    );
    expect(frontmatter(contents)).toContain('ok: "8px"');
    expect(frontmatter(contents)).not.toContain("50%");
    expect(warnings.join(" ")).toContain("spacing.bad");
  });

  test("warns that container/animation/keyframes stay in the framework artifacts", () => {
    const { warnings } = emitDesignMdContents(theme({ container: { center: true } }));
    expect(warnings.join(" ")).toContain("no DESIGN.md home");
  });

  test("describes shadows in prose, because the spec has no elevation tokens", () => {
    const { contents } = emitDesignMdContents(theme({ shadows: { card: "0 1px 2px #0002" } }));
    expect(contents).toContain("## Elevation & Depth");
    expect(contents).toContain("`card`");
    expect(contents).toContain("no token group for elevation");
  });
});

describe("emitDesignMdContents — body", () => {
  test("emits all eight sections in the spec's order", () => {
    const { contents } = emitDesignMdContents(theme());
    const headings = contents.match(/^## .+$/gm)?.map((h) => h.slice(3));
    expect(headings).toEqual([
      "Overview",
      "Colors",
      "Typography",
      "Layout",
      "Elevation & Depth",
      "Shapes",
      "Components",
      "Do's and Don'ts",
    ]);
  });

  test("authored prose replaces the generated text", () => {
    const { contents } = emitDesignMdContents(theme(), {
      prose: { Overview: "Loud, fast, and unapologetically orange." },
    });
    expect(contents).toContain("Loud, fast, and unapologetically orange.");
    expect(contents).not.toContain("described here by its tokens");
  });

  test("an alias heading the spec allows is matched to its canonical section", () => {
    // The examples Google ships open with `## Brand & Style`; matching only on
    // `Overview` would silently drop the brand voice on every round trip.
    const { contents } = emitDesignMdContents(theme(), {
      prose: { "Brand & Style": "Quiet and precise." } as never,
    });
    expect(contents).toContain("## Overview\n\nQuiet and precise.");
    expect(contents).not.toContain("## Brand & Style");
  });

  test("an empty authored section falls back rather than emitting nothing", () => {
    const { contents } = emitDesignMdContents(theme(), { prose: { Shapes: "   " } });
    expect(contents).toContain("Corner radii:");
  });

  test("a dark emit says the light palette lives in another file", () => {
    const withDark = theme({ colorsDark: { background: "#000000" } });
    expect(emitDesignMdContents(withDark, { mode: "light" }).contents).toContain(
      "the dark one is a separate file",
    );
    expect(emitDesignMdContents(withDark, { mode: "dark" }).contents).toContain('"#000000"');
  });
});
