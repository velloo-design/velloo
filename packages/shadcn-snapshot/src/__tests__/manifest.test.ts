import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { componentsDir, entryCssPath, loadManifest, registry, snapshotVersion } from "../index.ts";

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
