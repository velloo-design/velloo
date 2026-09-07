import { describe, expect, test } from "bun:test";
import { COMPONENT_GROUPS, groupLabel } from "@velloo/provider";
import { componentIndex } from "../discovery.ts";

/**
 * `list_components`' default view. Two things ride on it: the first call of a
 * session is the whole catalog, so the shape decides what that costs; and the
 * family/pieces relationship is the only place an agent is told that `Field`
 * is composed of `FieldLabel` and friends rather than being their peer.
 */
const entry = (
  id: string,
  extra: Partial<Parameters<typeof componentIndex>[0][number]> = {},
): Parameters<typeof componentIndex>[0][number] => ({
  id,
  availableInDesign: true,
  installedInApp: true,
  ...extra,
});

const index = (entries: Parameters<typeof componentIndex>[0]) =>
  componentIndex(entries, COMPONENT_GROUPS, (group) =>
    groupLabel(COMPONENT_GROUPS.find((g) => g.id === group)?.id),
  );

describe("componentIndex", () => {
  test("folds sub-pieces into their family root", () => {
    const result = index([
      entry("Field", { group: "forms", family: "Field" }),
      entry("FieldLabel", { group: "forms", family: "Field" }),
      entry("FieldError", { group: "forms", family: "Field" }),
    ]);
    expect(result.groups).toHaveLength(1);
    const [forms] = result.groups;
    expect(forms?.label).toBe("Forms & Inputs");
    expect(forms?.families).toEqual([{ id: "Field", pieces: ["FieldError", "FieldLabel"] }]);
    // The count still reports every component, so "292 components" doesn't
    // silently become "66" when the view collapses them.
    expect(result.totals).toEqual({ components: 3, families: 1 });
  });

  test("leaves a lone component without a pieces key", () => {
    const result = index([entry("Button", { group: "actions", family: "Button" })]);
    expect(result.groups[0]?.families).toEqual([{ id: "Button" }]);
  });

  test("orders shelves as the vocabulary declares, not by insertion", () => {
    const result = index([
      entry("Chart", { group: "visuals", family: "Chart" }),
      entry("Button", { group: "actions", family: "Button" }),
      entry("Card", { group: "display", family: "Card" }),
    ]);
    expect(result.groups.map((g) => g.group)).toEqual(["actions", "display", "visuals"]);
  });

  test("keeps an ungrouped component visible in a named bucket", () => {
    // The failure this guards is a component that exists and renders but
    // appears on no shelf, so nothing ever lists it.
    const result = index([entry("Mystery")]);
    expect(result.groups).toEqual([
      { group: "other", label: "Components", families: [{ id: "Mystery" }] },
    ]);
  });

  test("treats a family-less entry as its own family", () => {
    const result = index([entry("DataTable", { group: "display" })]);
    expect(result.groups[0]?.families).toEqual([{ id: "DataTable" }]);
  });

  test("carries a family's usage note", () => {
    const result = index([
      entry("Empty", { group: "feedback", family: "Empty", designModeNotes: "The empty state." }),
    ]);
    expect(result.groups[0]?.families[0]?.designModeNotes).toBe("The empty state.");
  });

  test("attributes a sub-piece's note so folding does not lose it", () => {
    // FieldError's `errors` shape is documented on the piece, but only the
    // family survives into this view.
    const result = index([
      entry("Field", { group: "forms", family: "Field", designModeNotes: "The scaffold." }),
      entry("FieldError", {
        group: "forms",
        family: "Field",
        designModeNotes: "Takes objects, not a string.",
      }),
    ]);
    expect(result.groups[0]?.families[0]?.designModeNotes).toBe(
      "The scaffold. FieldError: Takes objects, not a string.",
    );
  });

  describe("availability", () => {
    test("says nothing when everything renders and is installed", () => {
      // The saving that makes this view affordable: the common case is silence
      // rather than two true flags on all 292 entries.
      const result = index([entry("Button", { group: "actions", family: "Button" })]);
      expect(result.unavailableInDesign).toBeUndefined();
      expect(result.notInstalledInApp).toBeUndefined();
    });

    test("reports only the exceptions", () => {
      const result = index([
        entry("Button", { group: "actions", family: "Button" }),
        entry("Sidebar", { group: "layout", family: "Sidebar", availableInDesign: false }),
        entry("Chart", { group: "visuals", family: "Chart", installedInApp: false }),
      ]);
      expect(result.unavailableInDesign).toEqual(["Sidebar"]);
      expect(result.notInstalledInApp).toEqual(["Chart"]);
    });
  });

  test("is markedly cheaper than the per-component summary", () => {
    // The regression is silent and only bites in production: the index is the
    // default first call of every session, and the catalog grew from 143 to
    // 292 components. If a change makes this view per-component again, the
    // cost doubles with nothing failing.
    const entries = Array.from({ length: 292 }, (_, i) =>
      entry(i % 5 === 0 ? `Fam${i}` : `Fam${i - (i % 5)}Piece${i}`, {
        group: "forms",
        family: `Fam${i - (i % 5)}`,
      }),
    );
    const indexed = JSON.stringify(index(entries)).length;
    const perComponent = JSON.stringify(
      entries.map((e) => ({
        id: e.id,
        category: "ui",
        source: "shadcn",
        props: [],
        kind: "library",
        availableInDesign: true,
        installedInApp: true,
      })),
    ).length;
    expect(indexed).toBeLessThan(perComponent / 2);
  });
});
