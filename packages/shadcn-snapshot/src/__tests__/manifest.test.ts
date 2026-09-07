import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { FAMILY_GROUPS, UNGROUPED_FAMILIES } from "../groups.ts";
import { componentsDir, entryCssPath, loadManifest, registry, snapshotVersion } from "../index.ts";
import { COMPONENT_NOTES } from "../notes.ts";

/** Helpers a note may reference; they ship from `@velloo/helpers`. */
const HELPER_IDS = new Set(["Box", "Text", "Icon", "Heading", "Image", "Placeholder"]);

describe("registry", () => {
  test("has the starter components", () => {
    const ids = Object.keys(registry).sort();
    for (const id of [
      "Badge",
      "Button",
      "Card",
      "Heading",
      "Input",
      "Label",
      "Separator",
      "Text",
    ]) {
      expect(ids).toContain(id);
    }
  });

  test("has the post-Sprint-J components (Alert, Tabs, Switch, Tooltip, …)", () => {
    const ids = Object.keys(registry);
    for (const id of [
      "Alert",
      "Avatar",
      "Checkbox",
      "Progress",
      "Skeleton",
      "Switch",
      "Table",
      "Tabs",
      "Textarea",
      "Tooltip",
    ]) {
      expect(ids).toContain(id);
    }
  });

  test("has the post-Sprint-L marketing helpers (SVG, Image, Layer, Divider, Gradient)", () => {
    const ids = Object.keys(registry);
    for (const id of ["SVG", "Image", "Layer", "Divider", "Gradient"]) {
      expect(ids).toContain(id);
    }
  });

  test("has the layout and chat families added in the 2026.09 pull", () => {
    const ids = Object.keys(registry);
    for (const id of [
      "AspectRatio",
      "Bubble",
      "ButtonGroup",
      "Combobox",
      "ContextMenu",
      "Drawer",
      "Empty",
      "Field",
      "HoverCard",
      "InputGroup",
      "Item",
      "Kbd",
      "Menubar",
      "Message",
      "NativeSelect",
      "NavigationMenu",
      "Spinner",
    ]) {
      expect(ids).toContain(id);
    }
  });
});

describe("server rendering", () => {
  /**
   * The canvas renders designs through `react-dom/server`, so a component that
   * only paints after a browser measures it is worse than useless — it leaves a
   * blank hole in the design and in every screenshot. Roots have to produce
   * markup on their own; parts that legitimately need a parent's context (a
   * TabsTrigger outside Tabs) are exercised through their root instead.
   */
  test("every root component produces markup with no props", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");

    const roots = [
      "Accordion",
      "Alert",
      "AspectRatio",
      "Avatar",
      "Badge",
      "Breadcrumb",
      "Bubble",
      "Button",
      "ButtonGroup",
      "Card",
      "Chart",
      "Checkbox",
      "Combobox",
      "Drawer",
      "Empty",
      "Field",
      "Input",
      "InputGroup",
      "Item",
      "Kbd",
      "Message",
      "NativeSelect",
      "Pagination",
      "Progress",
      "Separator",
      "Skeleton",
      "Spinner",
      "Table",
      "Tabs",
      "Textarea",
    ];

    const blank: string[] = [];
    for (const id of roots) {
      const Component = registry[id];
      expect(Component, `${id} missing from registry`).toBeDefined();
      if (!Component) continue;
      const html = renderToStaticMarkup(createElement(Component));
      if (html.trim() === "") blank.push(id);
    }
    expect(blank).toEqual([]);
  });

  /**
   * The canvas-safe contract (see components/canvas-portal.tsx): overlay
   * content renders inline and always-open, so the design surface shows the
   * styled state. A re-vendor that restored upstream's Portal would compile and
   * pass every other test while silently emptying every modal on the canvas.
   */
  test("overlay content renders inline, open, and outside its root", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");

    for (const id of [
      "DialogContent",
      "AlertDialogContent",
      "SheetContent",
      "PopoverContent",
      "DropdownMenuContent",
      "ContextMenuContent",
      "MenubarContent",
      "SelectContent",
      "TooltipContent",
      "HoverCardContent",
      "DrawerContent",
      "ComboboxContent",
    ]) {
      const Component = registry[id];
      expect(Component, `${id} missing from registry`).toBeDefined();
      if (!Component) continue;
      const html = renderToStaticMarkup(createElement(Component, {}, "body"));
      expect(html, `${id} rendered nothing`).toContain("body");
      expect(html, `${id} is not pinned open`).toContain('data-state="open"');
    }
  });

  /**
   * Select bypasses Radix entirely below the root — Content, Item and Value are
   * inline elements — so no part of it may reach for the root's context. Radix's
   * own trigger *throws* when that context is missing, and a design is free to
   * place a trigger on its own: two screens in this repo's design folder do. One
   * throwing node fails the whole SSR, so restoring `SelectPrimitive.Trigger`
   * here turns every screen that holds a bare trigger into a blank frame.
   */
  test("select parts render on their own, with no Select ancestor", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");

    for (const id of ["SelectTrigger", "SelectValue", "SelectItem", "SelectGroup"]) {
      const Component = registry[id];
      expect(Component, `${id} missing from registry`).toBeDefined();
      if (!Component) continue;
      const html = renderToStaticMarkup(createElement(Component, {}, "body"));
      expect(html, `${id} rendered nothing`).toContain("body");
    }
  });
});

describe("snapshot artifacts", () => {
  test("snapshotVersion is set and non-empty", () => {
    expect(typeof snapshotVersion).toBe("string");
    expect(snapshotVersion.length).toBeGreaterThan(0);
  });

  test("entryCssPath points at a real Tailwind entry with the theme block", async () => {
    const css = await readFile(entryCssPath, "utf8");
    expect(css).toContain(`@import "tailwindcss"`);
    expect(css).toContain("@theme");
    expect(css).toContain("--color-primary");
  });

  test("componentsDir resolves to a directory containing snapshot sources", async () => {
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(componentsDir);
    expect(files.length).toBeGreaterThan(0);
  });

  test("loadManifest returns descriptors for every registry entry", async () => {
    const manifest = await loadManifest();
    const manifestIds = manifest.map((c) => c.id).sort();
    const registryIds = Object.keys(registry).sort();
    expect(manifestIds).toEqual(registryIds);

    const button = manifest.find((c) => c.id === "Button");
    expect(button?.source).toBe("shadcn");
    expect(button?.category).toBe("ui");
    expect(button?.props.some((p) => p.name === "asChild")).toBe(true);

    const heading = manifest.find((c) => c.id === "Heading");
    expect(heading?.source).toBe("velloo");
    expect(heading?.category).toBe("typography");
  });

  /**
   * Grouping is what makes a 292-component library browsable — in the canvas
   * sidebar and in `list_components`' index. It used to be a hand-kept list of
   * ids living in the canvas, and a snapshot refresh silently left 20 new
   * families off every shelf. These assert the data is complete at the source,
   * so the next refresh fails here instead of shipping an invisible component.
   */
  describe("browsing metadata", () => {
    test("every vendored family is deliberately grouped", async () => {
      // One file per family, which is also how build.ts keys the grouping.
      const files = (await readdir(join(componentsDir, "ui"))).filter((f) => f.endsWith(".tsx"));
      const families = files.map((f) => basename(f, ".tsx"));
      const missing = families.filter(
        (family) => !(family in FAMILY_GROUPS) && !UNGROUPED_FAMILIES.has(family),
      );
      // Add the family to FAMILY_GROUPS (or, if it renders no UI of its own,
      // to UNGROUPED_FAMILIES) rather than relaxing this.
      expect(missing).toEqual([]);
      expect(families.length).toBeGreaterThan(50);
    });

    test("every component lands on a shelf and names its family", async () => {
      const manifest = await loadManifest();
      const ungrouped = manifest.filter((c) => !c.group).map((c) => c.id);
      // DirectionProvider is a context wrapper, not something anyone browses.
      expect(ungrouped).toEqual(["DirectionProvider"]);
      expect(manifest.filter((c) => !c.family)).toEqual([]);
    });

    test("sub-pieces point at their family root, which is itself a component", async () => {
      const manifest = await loadManifest();
      const byId = new Map(manifest.map((c) => [c.id, c]));
      for (const descriptor of manifest) {
        expect(byId.has(descriptor.family ?? "")).toBe(true);
      }
      expect(byId.get("FieldLabel")?.family).toBe("Field");
      expect(byId.get("Field")?.family).toBe("Field");
      // Two upstream files are named after neither their component nor their
      // export, so the root cannot be guessed from the filename.
      expect(byId.get("Toaster")?.family).toBe("Toaster");
      expect(byId.get("DirectionProvider")?.family).toBe("DirectionProvider");
    });

    test("a family shares one shelf with all of its pieces", async () => {
      const manifest = await loadManifest();
      const groupOf = new Map(manifest.map((c) => [c.id, c.group]));
      for (const descriptor of manifest) {
        expect(descriptor.group).toBe(groupOf.get(descriptor.family ?? descriptor.id));
      }
    });

    /**
     * Prop names say what a component takes, never that a label + control +
     * help-text stack is what `Field` is *for*. These are the families that
     * postdate most models' training data, so without a note they get
     * hand-rolled out of Box and Text.
     */
    test("the families an agent would otherwise rebuild carry usage notes", async () => {
      const manifest = await loadManifest();
      const byId = new Map(manifest.map((c) => [c.id, c]));
      for (const id of [
        "Field",
        "InputGroup",
        "Item",
        "Empty",
        "ButtonGroup",
        "Kbd",
        "Spinner",
        "NativeSelect",
        "Combobox",
        "Drawer",
        "HoverCard",
        "ContextMenu",
        "Menubar",
        "NavigationMenu",
        "Message",
        "Bubble",
      ]) {
        expect(byId.get(id)?.designModeNotes ?? "").not.toBe("");
      }
    });

    test("notes name only components that exist", async () => {
      const manifest = await loadManifest();
      const ids = new Set(manifest.map((c) => c.id));
      // A note's whole job is pointing at sibling components; a typo'd or
      // dropped name sends the agent to compose a tag that does not resolve.
      for (const [id, note] of Object.entries(COMPONENT_NOTES)) {
        expect(ids).toContain(id);
        for (const referenced of note.match(/`([A-Z][A-Za-z]+)`/g) ?? []) {
          const name = referenced.slice(1, -1);
          expect(ids.has(name) || HELPER_IDS.has(name)).toBe(true);
        }
      }
    });
  });

  test("infers control type for known props", async () => {
    const manifest = await loadManifest();

    const asChild = manifest
      .find((c) => c.id === "Button")
      ?.props.find((p) => p.name === "asChild");
    expect(asChild?.control).toBe("boolean");

    const level = manifest.find((c) => c.id === "Heading")?.props.find((p) => p.name === "level");
    expect(level?.control).toBe("enum");
    expect(level?.enumValues).toEqual([1, 2, 3, 4, 5, 6]);

    const variant = manifest.find((c) => c.id === "Text")?.props.find((p) => p.name === "variant");
    expect(variant?.control).toBe("enum");
    // Order of union members is TypeScript-inferred; test set-equality.
    expect(new Set(variant?.enumValues ?? [])).toEqual(
      new Set(["default", "muted", "small", "lead"]),
    );
  });

  test("extracts cva variant/size props from VariantProps<typeof X>", async () => {
    const manifest = await loadManifest();

    const button = manifest.find((c) => c.id === "Button");
    const buttonVariant = button?.props.find((p) => p.name === "variant");
    expect(buttonVariant?.control).toBe("enum");
    expect(buttonVariant?.enumValues).toContain("default");
    expect(buttonVariant?.enumValues).toContain("destructive");

    const buttonSize = button?.props.find((p) => p.name === "size");
    expect(buttonSize?.control).toBe("enum");
    expect(buttonSize?.enumValues).toContain("sm");
    expect(buttonSize?.enumValues).toContain("lg");
    expect(buttonSize?.defaultValue).toBe("default");

    const badgeVariant = manifest
      .find((c) => c.id === "Badge")
      ?.props.find((p) => p.name === "variant");
    expect(badgeVariant?.enumValues).toContain("outline");
  });
});
