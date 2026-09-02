import { describe, expect, test } from "bun:test";
import { typesetDraftCss } from "../typeset-draft.ts";

/**
 * The override a dragged rhythm control paints into every frame. It has to
 * mirror what `typesetCss` would emit for the same typeset, or the preview
 * shows something the commit will not reproduce.
 */
describe("typesetDraftCss", () => {
  test("the baseline lands on :root and .typeset, filled from the defaults", () => {
    const css = typesetDraftCss({ name: "default", typeset: { leading: 1.4 } });
    expect(css.startsWith(":root, .typeset {")).toBe(true);
    expect(css).toContain("--typeset-leading: 1.4;");
    // Non-partial: the controls the typeset left unauthored still resolve.
    expect(css).toContain("--typeset-size: 1em;");
    expect(css).toContain("--typeset-flow: 1.25em;");
  });

  test("a preset emits only what it authored, so the rest keeps inheriting", () => {
    const css = typesetDraftCss({ name: "docs", typeset: { leading: 2 } });
    expect(css.startsWith(".typeset-docs {")).toBe(true);
    expect(css).toContain("--typeset-leading: 2;");
    expect(css).not.toContain("--typeset-size");
    expect(css).not.toContain("--typeset-font-heading");
  });

  test("the derived ladder is never restated — it re-substitutes on the same element", () => {
    const css = typesetDraftCss({ name: "default", typeset: { size: "20px" } });
    expect(css).not.toContain("--text-h1");
    expect(css).not.toContain("--typeset-rhythm");
  });

  test("a preset with nothing authored produces no rule at all", () => {
    expect(typesetDraftCss({ name: "docs", typeset: {} })).toBe("");
  });

  test("a name that is not selector-safe produces nothing, never a broken rule", () => {
    expect(typesetDraftCss({ name: "} html {", typeset: { leading: 2 } })).toBe("");
  });
});
