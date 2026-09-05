import { describe, expect, test } from "bun:test";
import { exportsName } from "../host-source.ts";

/**
 * Forks routinely rename shadcn primitives (card.tsx → Panel, badge.tsx →
 * StatusChip). The family file still exists and still compiles, so without an
 * export check the canvas claims `exact`, hands React a module namespace object
 * at render, and silently drops the whole screen back to SSR.
 */
describe("exportsName", () => {
  test("recognizes the export shapes shadcn files use", () => {
    expect(exportsName("export function Button() {}", "Button")).toBe(true);
    expect(exportsName("const Button = 1;\nexport { Button, buttonVariants };", "Button")).toBe(
      true,
    );
    expect(exportsName("export const Card = 1;", "Card")).toBe(true);
    expect(exportsName("export class Card {}", "Card")).toBe(true);
    expect(exportsName("export { Chip as Badge };", "Badge")).toBe(true);
    expect(exportsName('export { Table } from "./table.tsx";', "Table")).toBe(true);
  });

  test("rejects a file that only exports a renamed primitive", () => {
    const badge = "export function StatusChip() {}\nexport function CountChip() {}";
    expect(exportsName(badge, "Badge")).toBe(false);
    const card = "export function Panel() {}\nexport function PanelHeader() {}";
    expect(exportsName(card, "Card")).toBe(false);
    expect(exportsName(card, "CardHeader")).toBe(false);
  });

  test("an import of the same name is not an export of it", () => {
    expect(exportsName('import { Badge } from "./badge.tsx";', "Badge")).toBe(false);
  });

  // A scan, not a parser: an export written inside a comment reads as real.
  // Erring permissive is deliberate — the cost is one component rendering from
  // the app instead of the fallback, not a wrong `exact` claim on a rename.
  test("a commented-out export is accepted (documented scan limitation)", () => {
    expect(exportsName("// export function Badge is planned", "Badge")).toBe(true);
  });

  test("is permissive about a wildcard re-export it cannot resolve", () => {
    expect(exportsName('export * from "./primitives.tsx";', "Badge")).toBe(true);
  });
});
