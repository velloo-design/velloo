import { describe, expect, test } from "bun:test";
import {
  DEFAULT_TYPESET_NAME,
  HEADING_ROLE_BY_LEVEL,
  TYPESET_CLASSES,
  TYPESET_DEFAULT,
  TYPESET_INLINE_STYLE,
  TYPESET_RATIOS,
  TYPESET_SCALE_NAMES,
  type Typeset,
  typesetCss,
  typesetSafelist,
  typesetScale,
  typesetThemeTokens,
  typesetVars,
} from "../typeset.ts";

describe("the ratio table is the only source of proportion", () => {
  test("every scale name has a ratio, classes, and an inline style", () => {
    for (const role of TYPESET_SCALE_NAMES) {
      expect(TYPESET_RATIOS[role]).toBeDefined();
      expect(TYPESET_CLASSES[role]).toBeTruthy();
      expect(TYPESET_INLINE_STYLE[role]).toBeDefined();
    }
    expect(TYPESET_SCALE_NAMES.length).toBe(Object.keys(TYPESET_CLASSES).length);
    expect(TYPESET_SCALE_NAMES.length).toBe(Object.keys(TYPESET_INLINE_STYLE).length);
  });

  test("vars and scale agree — the CSS and native paths derive from one table", () => {
    // `1rem` base makes the px math trivially checkable against the ratios.
    const typeset: Typeset = { size: 16, leading: 1.75, flow: "1.25em" };
    const scale = typesetScale(typeset, { rootPx: 16 });
    const css = typesetVars("").join("\n");

    for (const role of TYPESET_SCALE_NAMES) {
      const ratio = TYPESET_RATIOS[role];
      expect(scale[role].fontSize).toBeCloseTo(16 * ratio.size, 2);
      expect(scale[role].lineHeight).toBeCloseTo(1.75 * ratio.leading, 2);
      expect(scale[role].letterSpacing).toBe(ratio.tracking);
      expect(scale[role].fontWeight).toBe(ratio.weight);

      // The var form multiplies the same ratio symbolically.
      if (ratio.size === 1) {
        expect(css).toContain(`--text-${role}: var(--typeset-rhythm);`);
      } else {
        expect(css).toContain(`--text-${role}: calc(var(--typeset-rhythm) * ${ratio.size});`);
      }
      expect(css).toContain(`--tracking-${role}: ${ratio.tracking};`);
    }
  });

  test("inline styles reference exactly the vars typesetVars declares", () => {
    const declared = typesetVars("").join("\n");
    for (const role of TYPESET_SCALE_NAMES) {
      const style = TYPESET_INLINE_STYLE[role];
      for (const ref of [style.fontSize, style.lineHeight, style.letterSpacing]) {
        const name = /^var\((--[\w-]+)\)$/.exec(ref)?.[1];
        expect(name).toBeTruthy();
        expect(declared).toContain(`${name}:`);
      }
      // Weight is a literal: it never varies with rhythm.
      expect(style.fontWeight).toBe(TYPESET_RATIOS[role].weight);
    }
  });

  test("scale names avoid the color and font-family namespaces", () => {
    // `text-<role>` would collide with the `text-<color>` utility a
    // `--color-<name>` token generates; `font-<role>` with a font family.
    const colorSlots = [
      "background",
      "foreground",
      "primary",
      "secondary",
      "muted",
      "accent",
      "destructive",
      "card",
      "popover",
      "border",
      "input",
      "ring",
    ];
    for (const role of TYPESET_SCALE_NAMES) {
      expect(colorSlots).not.toContain(role);
    }
    // Weight comes from stock utilities, so no `font-<role>` is generated.
    for (const classes of Object.values(TYPESET_CLASSES)) {
      expect(classes).toMatch(/font-(normal|medium|semibold|bold)$/);
    }
  });
});

describe("typesetVars / typesetCss", () => {
  test("derived vars sit in the same rule as the authored controls", () => {
    // This co-location is what makes a preset re-derive the whole ladder.
    const css = typesetCss({ [DEFAULT_TYPESET_NAME]: {}, compact: { size: 14, leading: 1.6 } });
    const typesetRule = css.slice(
      css.indexOf(".typeset {"),
      css.indexOf("}", css.indexOf(".typeset {")),
    );
    expect(typesetRule).toContain("--typeset-size:");
    expect(typesetRule).toContain("--typeset-leading:");
    expect(typesetRule).toContain("--text-h1:");
    expect(typesetRule).toContain("--leading-body:");
  });

  test("presets override only the authored controls", () => {
    const css = typesetCss({ [DEFAULT_TYPESET_NAME]: {}, compact: { size: 14, leading: 1.6 } });
    const start = css.indexOf(".typeset-compact {");
    expect(start).toBeGreaterThan(-1);
    const rule = css.slice(start, css.indexOf("}", start));
    expect(rule).toContain("--typeset-size: 14px;");
    expect(rule).toContain("--typeset-leading: 1.6;");
    // A derived var here would pin the ladder to the preset's own scope and
    // break the re-derivation contract.
    expect(rule).not.toContain("--text-h1:");
    expect(rule).not.toContain("--typeset-rhythm:");
  });

  test("a preset restates nothing it did not author", () => {
    // Restating a control the preset didn't set would reset it to the baseline
    // instead of inheriting the folder default — e.g. a size-only preset would
    // silently drop the theme's display face back to the body font.
    const css = typesetCss({
      [DEFAULT_TYPESET_NAME]: { fontHeading: "display", fontBody: "sans" },
      compact: { size: 14 },
    });
    const start = css.indexOf(".typeset-compact {");
    const rule = css.slice(start, css.indexOf("}", start));
    expect(rule).toContain("--typeset-size: 14px;");
    expect(rule).not.toContain("--typeset-font-heading");
    expect(rule).not.toContain("--typeset-font-body");
    expect(rule).not.toContain("--typeset-leading");
    expect(rule).not.toContain("--typeset-flow");
  });

  test("a preset that authors a face overrides only that face", () => {
    const css = typesetCss({
      [DEFAULT_TYPESET_NAME]: { fontHeading: "display" },
      serif: { fontBody: "reading" },
    });
    const start = css.indexOf(".typeset-serif {");
    const rule = css.slice(start, css.indexOf("}", start));
    expect(rule).toContain("--typeset-font-body: var(--font-reading);");
    expect(rule).not.toContain("--typeset-font-heading");
  });

  test("element rules are fully :where()-wrapped so utilities win", () => {
    const css = typesetCss({ [DEFAULT_TYPESET_NAME]: {}, docs: { size: 15 } });
    // Selectors, not lines: a long selector list is wrapped across lines, so a
    // per-line check would read its continuations as bare `.typeset p` rules.
    const selectors = [...css.matchAll(/(^|[};])\s*([^{};]+?)\s*\{/g)]
      .map((m) => (m[2] ?? "").replace(/\s+/g, " ").trim())
      .filter((sel) => sel.includes(".typeset"));

    // A bare `.typeset <element>` selector would carry class specificity and
    // beat an authored utility. Every element rule must therefore be
    // `:where()`-wrapped; only the custom-property blocks (`.typeset {`,
    // `.typeset-docs {`) may name the class directly, and they target nothing
    // inside it.
    const propertyBlock = /^\.typeset[\w-]*(\s*,\s*\.typeset[\w-]*)*$/;
    const bare = selectors.filter((sel) => !sel.startsWith(":where(") && !propertyBlock.test(sel));
    expect(bare).toEqual([]);

    const wrapped = selectors.filter((sel) => sel.startsWith(":where("));
    expect(wrapped.length).toBeGreaterThan(10);
    // The wrapped flow list keeps every element it covers.
    expect(
      wrapped.some((sel) => sel.includes(".typeset p,") && sel.includes(".typeset figure")),
    ).toBe(true);
    expect(css).toContain(":where(.typeset) {");
    expect(css).toContain(":where(.typeset h1) {");
  });

  test("block spacing is start-only, so appending never restyles earlier blocks", () => {
    const css = typesetCss({ [DEFAULT_TYPESET_NAME]: {} });
    expect(css).toContain("margin-block-start:");
    expect(css).not.toMatch(/:last-child|:has\(|:empty/);
    // Every margin-block-end is an explicit zero reset, never a spacing value.
    for (const line of css.split("\n").filter((l) => l.includes("margin-block-end"))) {
      expect(line).toContain("margin-block-end: 0;");
    }
  });

  test("the narrow bump rides on the derived rhythm so every preset inherits it", () => {
    const css = typesetCss({ [DEFAULT_TYPESET_NAME]: {}, docs: { size: 15 } });
    expect(css).toContain("@media (width < 48rem)");
    expect(css).toContain("--typeset-rhythm: calc(var(--typeset-size) * 1.125);");
  });

  test("omitting the root block keeps the region rules", () => {
    const css = typesetCss({ [DEFAULT_TYPESET_NAME]: {} }, { root: false });
    expect(css).not.toContain(":root {");
    expect(css).toContain(".typeset {");
  });

  test("font roles resolve to --font-<role>, unsafe names fall back", () => {
    const css = typesetCss({
      [DEFAULT_TYPESET_NAME]: { fontHeading: "display", fontBody: "sans" },
    });
    expect(css).toContain("--typeset-font-heading: var(--font-display);");
    expect(css).toContain("--typeset-font-body: var(--font-sans);");

    const hostile = typesetCss({ [DEFAULT_TYPESET_NAME]: { fontHeading: "a; } evil {" } });
    expect(hostile).toContain("--typeset-font-heading: var(--typeset-font-body);");
    expect(hostile).not.toContain("evil");
  });

  test("a hostile token value cannot break out of its declaration", () => {
    const css = typesetCss({
      [DEFAULT_TYPESET_NAME]: { size: "16px} .evil { color: red", flow: "1em; } body {" },
    });
    // The value may survive as inert garbage; what must not survive is the
    // punctuation that would end the declaration or the rule.
    for (const line of css.split("\n").filter((l) => l.includes("--typeset-size:"))) {
      expect(line).toMatch(/^\s*--typeset-size:[^{};]*;$/);
    }
    for (const line of css.split("\n").filter((l) => l.includes("--typeset-flow:"))) {
      expect(line).toMatch(/^\s*--typeset-flow:[^{};]*;$/);
    }
  });

  test("a preset name that is not a safe ident is dropped", () => {
    const css = typesetCss({
      [DEFAULT_TYPESET_NAME]: {},
      "bad name": { size: 12 },
      ok: { size: 13 },
    });
    expect(css).not.toContain("bad name");
    expect(css).toContain(".typeset-ok {");
  });

  test("defaults match the baseline rhythm", () => {
    const css = typesetCss(undefined);
    expect(css).toContain(`--typeset-size: ${TYPESET_DEFAULT.size};`);
    expect(css).toContain(`--typeset-leading: ${TYPESET_DEFAULT.leading};`);
    expect(css).toContain(`--typeset-flow: ${TYPESET_DEFAULT.flow};`);
  });
});

describe("JIT surface", () => {
  test("the safelist covers every utility the scale produces", () => {
    const safelist = typesetSafelist().join(" ");
    for (const role of TYPESET_SCALE_NAMES) {
      expect(safelist).toContain(role);
    }
    expect(safelist).toContain("{text,leading,tracking}-{");
    expect(safelist).toContain("font-{normal,medium,semibold,bold}");
  });

  test("theme tokens declare every namespaced utility", () => {
    const tokens = typesetThemeTokens().join("\n");
    for (const role of TYPESET_SCALE_NAMES) {
      expect(tokens).toContain(`--text-${role}:`);
      expect(tokens).toContain(`--leading-${role}:`);
      expect(tokens).toContain(`--tracking-${role}:`);
    }
  });
});

describe("typesetScale", () => {
  test("relative sizes resolve against rootPx", () => {
    expect(typesetScale({ size: "1em" }, { rootPx: 16 }).body.fontSize).toBe(16);
    expect(typesetScale({ size: "1em" }, { rootPx: 20 }).body.fontSize).toBe(20);
    expect(typesetScale({ size: "1.5rem" }, { rootPx: 16 }).body.fontSize).toBe(24);
    expect(typesetScale({ size: "15px" }).body.fontSize).toBe(15);
    expect(typesetScale({ size: 15 }).body.fontSize).toBe(15);
    expect(typesetScale({ size: "nonsense" }, { rootPx: 16 }).body.fontSize).toBe(16);
  });

  test("heading roles take the heading face, copy takes the body face", () => {
    const scale = typesetScale(
      { fontHeading: "display", fontBody: "sans" },
      { fontFamily: { display: '"Unbounded", sans-serif', sans: "Inter, sans-serif" } },
    );
    expect(scale.h1.fontFamily).toBe('"Unbounded", sans-serif');
    expect(scale.body.fontFamily).toBe("Inter, sans-serif");
  });

  test("headings fall back to the body face when no heading role is set", () => {
    const scale = typesetScale({ fontBody: "sans" }, { fontFamily: { sans: "Inter, sans-serif" } });
    expect(scale.h1.fontFamily).toBe("Inter, sans-serif");
  });

  test("an unresolvable role omits fontFamily rather than inventing one", () => {
    const scale = typesetScale({ fontHeading: "ghost" }, { fontFamily: {} });
    expect(scale.h1.fontFamily).toBeUndefined();
  });

  test("heading levels map onto the ladder in descending size", () => {
    const scale = typesetScale({ size: 16 });
    const sizes = [1, 2, 3, 4, 5, 6].map(
      (level) => scale[HEADING_ROLE_BY_LEVEL[level] as keyof typeof scale].fontSize,
    );
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i] as number).toBeLessThanOrEqual(sizes[i - 1] as number);
    }
  });
});
