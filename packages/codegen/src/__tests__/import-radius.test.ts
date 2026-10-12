import { describe, expect, test } from "bun:test";
import { parseThemeCss } from "../import-theme/parse-css.ts";
import { importedRadius } from "../import-theme/radius.ts";

/** What `velloo init` scaffolds, and Tailwind's own scale. */
const SCAFFOLD = { sm: 4, md: 6, lg: 8, xl: 12, full: 9999 };

const radiusAfter = (css: string, current = SCAFFOLD) =>
  importedRadius(current, parseThemeCss(css));

/**
 * `md` is where a theme keeps its base, and the other steps derive from it
 * unless the theme states them. So a base imported onto a scale that came from
 * somewhere else has to take the scale with it.
 */
describe("the corner scale a stylesheet import leaves a theme with", () => {
  test("a base alone replaces the scale it lands on", () => {
    expect(radiusAfter(":root { --radius: 0rem; }")).toEqual({ md: "0rem", full: 9999 });
  });

  test("a stock shadcn sheet's ladder is still only a base", () => {
    const css = `:root { --radius: 0.625rem; }
@theme inline {
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
}`;
    expect(radiusAfter(css)).toEqual({ md: "0.625rem", full: 9999 });
  });

  test("importing the same sheet twice changes nothing the second time", () => {
    const once = radiusAfter(":root { --radius: 0.75rem; }");
    expect(importedRadius(once, parseThemeCss(":root { --radius: 0.75rem; }"))).toEqual(once);
  });

  test("steps with no base are laid on the scale that is there", () => {
    expect(radiusAfter("@theme { --radius-sm: 0.5rem; --radius-md: 0.75rem; }")).toEqual({
      ...SCAFFOLD,
      sm: "0.5rem",
      md: "0.75rem",
    });
  });

  test("a step named beside the base is kept beside it", () => {
    const css = ":root { --radius: 0.5rem; } @theme { --radius-xl: 1rem; }";
    expect(radiusAfter(css)).toEqual({ md: "0.5rem", xl: "1rem", full: 9999 });
  });

  test("a sheet naming both the base and md keeps the base as lg", () => {
    const css = ":root { --radius: 0.5rem; } @theme { --radius-md: 0.75rem; }";
    expect(radiusAfter(css)).toEqual({ md: "0.75rem", lg: "0.5rem", full: 9999 });
  });

  test("a sheet that says nothing about corners leaves them alone", () => {
    expect(radiusAfter(":root { --background: #fff; }")).toEqual(SCAFFOLD);
  });
});
