import { describe, expect, test } from "bun:test";
import type { ComponentDescriptor } from "@velloo/provider";
import { categoryForComponent, libraryCategories } from "../library-categories.ts";

/**
 * The Library panel's shelves.
 *
 * These used to come from a hand-kept list of ids in this package, so the
 * panel showed only what someone had remembered to add: when the snapshot
 * refresh took the library from 143 to 292 components, all 20 new families
 * were unreachable in the UI and no test noticed. Deriving them from the
 * manifest is what these lock in.
 */
const descriptor = (id: string, extra: Partial<ComponentDescriptor> = {}): ComponentDescriptor => ({
  id,
  category: "ui",
  source: "shadcn",
  props: [],
  ...extra,
});

describe("libraryCategories", () => {
  test("shelves whatever the manifest carries, including families it has never heard of", () => {
    const shelves = libraryCategories([
      descriptor("Button", { group: "actions", family: "Button" }),
      descriptor("Field", { group: "forms", family: "Field" }),
      // Vendored after this file was written — the case that used to vanish.
      descriptor("SomethingNew", { group: "forms", family: "SomethingNew" }),
    ]);
    expect(shelves).toEqual([
      { id: "actions", label: "Actions", components: ["Button"] },
      { id: "forms", label: "Forms & Inputs", components: ["Field", "SomethingNew"] },
    ]);
  });

  test("lists family roots only, so pieces don't sit beside their own parent", () => {
    const shelves = libraryCategories([
      descriptor("Field", { group: "forms", family: "Field" }),
      descriptor("FieldLabel", { group: "forms", family: "Field" }),
      descriptor("FieldError", { group: "forms", family: "Field" }),
    ]);
    expect(shelves[0]?.components).toEqual(["Field"]);
  });

  test("keeps a component with no group on a visible shelf", () => {
    const shelves = libraryCategories([descriptor("Mystery")]);
    expect(shelves).toEqual([{ id: "other", label: "Components", components: ["Mystery"] }]);
  });

  test("treats a descriptor with no family as its own root", () => {
    // Providers other than shadcn don't populate `family`; their components
    // still have to appear.
    const shelves = libraryCategories([descriptor("Paper", { group: "layout", source: "mui" })]);
    expect(shelves[0]?.components).toEqual(["Paper"]);
  });

  test("orders shelves by the shared vocabulary and sorts within them", () => {
    const shelves = libraryCategories([
      descriptor("Icon", { group: "visuals", family: "Icon" }),
      descriptor("Toggle", { group: "actions", family: "Toggle" }),
      descriptor("Button", { group: "actions", family: "Button" }),
    ]);
    expect(shelves.map((s) => s.id)).toEqual(["actions", "visuals"]);
    expect(shelves[0]?.components).toEqual(["Button", "Toggle"]);
  });

  test("renders nothing before the manifest has loaded", () => {
    expect(libraryCategories(null)).toEqual([]);
    expect(libraryCategories([])).toEqual([]);
  });
});

describe("categoryForComponent", () => {
  test("names the shelf, and gives a sub-piece its family's", () => {
    const components = [
      descriptor("Field", { group: "forms", family: "Field" }),
      descriptor("FieldLabel", { group: "forms", family: "Field" }),
    ];
    expect(categoryForComponent(components, "Field")).toBe("Forms & Inputs");
    expect(categoryForComponent(components, "FieldLabel")).toBe("Forms & Inputs");
  });

  test("falls back rather than blanking the breadcrumb", () => {
    expect(categoryForComponent([descriptor("Mystery")], "Mystery")).toBe("Components");
    expect(categoryForComponent(null, "Button")).toBeNull();
    expect(categoryForComponent([], "Button")).toBeNull();
  });
});
