import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { emitDesignMdContents, markdownSections } from "@velloo/codegen";
import { unwrap } from "@velloo/result";
import { designTheme } from "../../testing/design-folder.ts";
import { mapDesignMd } from "../import-design-md.ts";

/**
 * Conformance against the examples google-labs-code/design.md actually ships.
 *
 * The format is at version `alpha` and says to expect changes. Support built
 * against a moving spec rots silently: a renamed token group would not break
 * anything velloo owns, it would just make imports map less and less until a
 * design quietly stopped matching the app. These fixtures are the tripwire,
 * because upstream revises the examples along with the spec.
 *
 * Refresh them with:
 *   for n in paws-and-paths atmospheric-glass totality-festival; do
 *     curl -sL -o "fixtures/design-md/$n.DESIGN.md" \
 *       "https://raw.githubusercontent.com/google-labs-code/design.md/main/examples/$n/DESIGN.md"
 *   done
 *
 * The real `@google/design.md` linter runs in the companion `.e2e.test.ts`,
 * which needs the network; this file stays offline.
 */

const FIXTURES = join(import.meta.dir, "fixtures", "design-md");
const fixture = (name: string): Promise<string> =>
  readFile(join(FIXTURES, `${name}.DESIGN.md`), "utf8");

const EXAMPLES = ["paws-and-paths", "atmospheric-glass", "totality-festival"] as const;

describe("the shipped examples", () => {
  test("every fixture is present and none was truncated on vendoring", async () => {
    const files = (await readdir(FIXTURES)).filter((f) => f.endsWith(".DESIGN.md")).sort();
    expect(files).toEqual(EXAMPLES.map((n) => `${n}.DESIGN.md`).sort());
    for (const name of EXAMPLES) {
      const src = await fixture(name);
      // A Windows checkout hands these over with CRLF line endings.
      expect(/^---\r?\n/.test(src)).toBe(true);
      expect(src.length).toBeGreaterThan(4000);
    }
  });

  for (const name of EXAMPLES) {
    test(`${name} maps all twelve semantic color slots`, async () => {
      const r = unwrap(mapDesignMd(designTheme(), await fixture(name)));
      // The claim the whole importer rests on. These files name their roles
      // after Material 3, so a regression in the alias table shows up here
      // rather than as a design that silently renders on the wrong palette.
      expect(r.coverage.unmapped).toEqual([]);
      expect(r.coverage.semantic).toBe(r.coverage.semanticTotal);
      expect(r.coverage.aliased.length).toBeGreaterThan(10);
    });

    test(`${name} still uses the token groups this importer reads`, async () => {
      const src = await fixture(name);
      const frontmatter = src.slice(0, src.indexOf("\n---", 4));
      // A spec revision that renames one of these is the drift we want to hear
      // about: nothing else in velloo would fail.
      for (const group of ["colors:", "typography:", "rounded:", "spacing:"]) {
        expect(frontmatter).toContain(`\n${group}`);
      }
      expect(frontmatter).toContain("\nname:");
      const r = unwrap(mapDesignMd(designTheme(), src));
      expect(r.theme.typography.fontFamily?.sans).toBeTruthy();
      expect(Object.keys(r.theme.radius).length).toBeGreaterThan(2);
      expect(Object.keys(r.theme.spacing).length).toBeGreaterThan(2);
    });

    test(`${name} carries prose in the spec's section order`, async () => {
      const r = unwrap(mapDesignMd(designTheme(), await fixture(name)));
      expect(r.prose.sections.length).toBeGreaterThanOrEqual(6);
      expect(r.prose.bytes).toBeGreaterThan(1000);
    });
  }
});

describe("round trip", () => {
  for (const name of EXAMPLES) {
    test(`${name} survives import → emit → import with the same colors`, async () => {
      const source = await fixture(name);
      const first = unwrap(mapDesignMd(designTheme(), source));
      const emitted = emitDesignMdContents(first.theme, { name, prose: markdownSections(source) });
      const second = unwrap(mapDesignMd(designTheme(), emitted.contents));

      // Velloo emits its own vocabulary, so the second pass matches by name
      // rather than through the alias table — and must land identically.
      expect(second.theme.colors).toEqual(first.theme.colors);
      expect(second.coverage.semantic).toBe(second.coverage.semanticTotal);
      expect(second.coverage.aliased).toEqual([]);
    });
  }

  test("the emitted file keeps the authored prose rather than describing tokens", async () => {
    const source = await fixture("paws-and-paths");
    const first = unwrap(mapDesignMd(designTheme(), source));
    const sections = markdownSections(source);
    const emitted = emitDesignMdContents(first.theme, { prose: sections });
    const overview = sections.Overview ?? sections["Brand & Style"];
    expect(overview).toBeTruthy();
    // Whatever the source called its first section, the emitted Overview must
    // be the author's words, not the generated "described here by its tokens".
    expect(emitted.contents).toContain((overview as string).split("\n")[0] as string);
    expect(emitted.contents).not.toContain("described here by its tokens");
  });

  test("a theme with a dark palette emits two files, because the format has one", async () => {
    const light = unwrap(mapDesignMd(designTheme(), await fixture("paws-and-paths")));
    const both = unwrap(
      mapDesignMd(light.theme, await fixture("atmospheric-glass"), { mode: "dark" }),
    );
    const lightOut = emitDesignMdContents(both.theme, { mode: "light" });
    const darkOut = emitDesignMdContents(both.theme, { mode: "dark" });
    expect(lightOut.contents).not.toBe(darkOut.contents);
    expect(lightOut.contents).toContain("#f9f9ff");
    expect(darkOut.contents).toContain("#0b1326");
    expect(lightOut.contents).toContain("the dark one is a separate file");
  });
});

/**
 * Vocabularies found by surveying the DESIGN.md files on GitHub (2026-09).
 * Authored here rather than vendored: the repos they were observed in carry no
 * license, and the point is the naming convention, not anyone's palette.
 */
describe("vocabularies other than Material 3", () => {
  const EDITORIAL = `---
name: Editorial
colors:
  canvas: "#010102"
  ink: "#f7f8f8"
  body: "#d0d6e0"
  primary: "#5e6ad2"
  on-primary: "#ffffff"
  primary-focus: "#5e69d1"
  surface-card: "#0f1011"
  surface-strong: "#18191a"
  hairline: "#23252a"
  hairline-soft: "#34343a"
  muted: "#8a8f98"
---
`;

  const BOOTSTRAP = `---
name: Bootstrap Classic
colors:
  primary: "#0d6efd"
  on-primary: "#ffffff"
  secondary: "#6c757d"
  on-secondary: "#ffffff"
  danger: "#dc3545"
  on-danger: "#ffffff"
  success: "#198754"
  background: "#ffffff"
  on-background: "#212529"
  surface: "#ffffff"
  on-surface: "#212529"
  border: "#dee2e6"
  muted: "#6c757d"
---
`;

  test("the editorial canvas/ink/hairline family reaches the page-level slots", () => {
    const r = unwrap(mapDesignMd(designTheme(), EDITORIAL));
    expect(r.theme.colors.background).toBe("#010102");
    expect(r.theme.colors.foreground).toBe("#f7f8f8");
    expect(r.theme.colors.card).toMatchObject({ DEFAULT: "#0f1011" });
    expect(r.theme.colors.popover).toMatchObject({ DEFAULT: "#18191a" });
    expect(r.theme.colors.border).toBe("#23252a");
    expect(r.theme.colors.input).toBe("#34343a");
    expect(r.theme.colors.ring).toBe("#5e69d1");
    // Here `muted` is a secondary TEXT grey, legible on the page — not a fill.
    // Read as velloo's muted surface it would paint every `bg-muted` grey.
    expect(r.theme.colors.muted).toMatchObject({ foreground: "#d0d6e0" });
    expect((r.theme.colors.muted as { DEFAULT: string }).DEFAULT).not.toBe("#8a8f98");
  });

  test("Bootstrap's `danger` is velloo's `destructive`", () => {
    const r = unwrap(mapDesignMd(designTheme(), BOOTSTRAP));
    expect(r.theme.colors.destructive).toEqual({ DEFAULT: "#dc3545", foreground: "#ffffff" });
    // `success` has no velloo slot; it must still be reachable as a class.
    expect(r.theme.palette?.success).toBe("#198754");
  });

  test("a file whose roles match nothing says so instead of reporting success", () => {
    const opaque = `---\nname: Opaque\ncolors:\n  smtc-web-page-primary: "#112233"\n  smtc-web-page-secondary: "#445566"\n---\n`;
    const r = unwrap(mapDesignMd(designTheme(), opaque));
    expect(r.coverage.semantic).toBe(0);
    expect(r.warnings.join(" ")).toContain("none of the");
    expect(r.warnings.join(" ")).toContain("does NOT theme the canvas");
  });
});
