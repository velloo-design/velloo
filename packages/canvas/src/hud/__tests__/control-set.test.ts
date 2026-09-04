import { describe, expect, test } from "bun:test";
import type { ComponentDescriptor } from "@velloo/provider";
import type { Node, Snippet } from "@velloo/schema";
import {
  barControls,
  colorChoices,
  fontChoices,
  resolveColorToken,
  resolveControls,
  roleOf,
} from "../control-set.ts";

const box = (props?: Record<string, unknown>, children?: Node[]): Node => ({
  $ref: "Box",
  ...(props ? { props } : {}),
  ...(children ? { children } : {}),
});

describe("roleOf", () => {
  test("reads a Box's role from its tag", () => {
    expect(roleOf(box({ as: "h1", children: "Title" }))).toBe("heading");
    expect(roleOf(box({ as: "h4", children: "Title" }))).toBe("heading");
    expect(roleOf(box({ as: "p", children: "Body" }))).toBe("text");
    expect(roleOf(box({ as: "span", children: "Body" }))).toBe("text");
  });

  test("a Box holding only a string is a text run however it's tagged", () => {
    expect(roleOf(box({ children: "just words" }))).toBe("text");
  });

  test("a Box with element children is a container", () => {
    expect(roleOf(box({ className: "flex" }, [box({ children: "x" })]))).toBe("box");
    expect(roleOf(box({ className: "flex" }))).toBe("box");
  });

  test("names the helper components directly", () => {
    expect(roleOf({ $ref: "Heading" })).toBe("heading");
    expect(roleOf({ $ref: "Text" })).toBe("text");
    expect(roleOf({ $ref: "Image" })).toBe("image");
    expect(roleOf({ $ref: "Icon" })).toBe("icon");
    expect(roleOf({ $ref: "Card" })).toBe("box");
  });

  test("a snippet instance is its own role", () => {
    expect(roleOf({ $snippet: "row", args: {} })).toBe("snippet");
  });

  test("anything unrecognised falls through", () => {
    expect(roleOf({ $ref: "Accordion" })).toBe("other");
  });
});

describe("resolveControls", () => {
  test("headings and text lead with the typography four, the rest waits in the pane", () => {
    const { controls } = resolveControls({ node: box({ as: "h1", children: "T" }) });
    expect(barControls(controls).map((c) => c.id)).toEqual([
      "font",
      "size",
      "weight",
      "align",
      "color",
    ]);
    expect(controls.map((c) => c.id)).toContain("leading");
  });

  test("a box's bar is spacing, colour and border — its size lives in the pane", () => {
    const { controls } = resolveControls({ node: box({ className: "p-4" }, [box()]) });
    expect(barControls(controls).map((c) => c.label)).toEqual([
      "Outside",
      "Inside",
      "Text",
      "Background",
      "Border",
      "Border color",
    ]);
    // Width and height are on the resize handles; the exact number is a pane away.
    const paned = controls.filter((c) => c.tier === "pane").map((c) => c.label);
    expect(paned).toEqual(["Width", "Height", "Between", "Corners", "Align"]);
  });

  test("every control is reachable — the bar is a subset, never a filter", () => {
    for (const node of [box({ as: "h1" }), box({}, [box()]), { $ref: "Image" } as Node]) {
      const { controls } = resolveControls({ node });
      expect(controls.length).toBeGreaterThanOrEqual(barControls(controls).length);
      expect(barControls(controls).length).toBeGreaterThan(0);
    }
  });

  test("never offers layout or positioning controls", () => {
    const banned = ["display", "position", "flexDirection", "justify", "items", "overflow"];
    for (const node of [box({ as: "h1" }), box({}, [box()]), { $ref: "Icon" } as Node]) {
      const { controls } = resolveControls({ node });
      for (const c of controls) {
        if (c.slot.via === "style") expect(banned).not.toContain(c.slot.key);
      }
    }
  });

  test("an image leads with its prompt", () => {
    const { controls } = resolveControls({ node: { $ref: "Image", props: { src: "x.png" } } });
    expect(controls[0]?.kind).toBe("prompt");
  });

  test("a snippet's set comes from its declared params", () => {
    const snippet: Snippet = {
      id: "row",
      name: "Row",
      params: [
        { name: "customer", type: "string" },
        { name: "amount", type: "number", min: 0, max: 9999 },
        { name: "status", type: "enum", enum: ["active", "past-due"] },
        { name: "trailing", type: "node" },
      ],
      tree: box(),
    } as Snippet;
    const { controls } = resolveControls({ node: { $snippet: "row" }, snippet });
    // The `node` param is a subtree slot; a bar control can't edit it.
    expect(controls.map((c) => c.id)).toEqual(["arg:customer", "arg:amount", "arg:status"]);
    expect(controls[1]?.min).toBe(0);
    expect(controls[2]?.choices?.map((o) => o.value)).toEqual(["active", "past-due"]);
  });

  test("the long tail borrows up to two enum props, then falls back", () => {
    const descriptor = {
      id: "Button",
      category: "ui",
      source: "shadcn",
      props: [
        { name: "className", type: "string", optional: true, control: "string" },
        {
          name: "variant",
          type: "string",
          optional: true,
          control: "enum",
          enumValues: ["default", "outline"],
        },
        { name: "size", type: "string", optional: true, control: "enum", enumValues: ["sm", "lg"] },
        {
          name: "disabled",
          type: "boolean",
          optional: true,
          control: "enum",
          enumValues: ["true"],
        },
      ],
    } as ComponentDescriptor;
    const { controls } = resolveControls({ node: { $ref: "Button" }, descriptor });
    // What distinguishes the component earns the bar; generic box styling waits.
    expect(barControls(controls).map((c) => c.label)).toEqual(["Variant", "Size"]);
    expect(controls.slice(2).every((c) => c.tier === "pane")).toBe(true);
    expect(controls.map((c) => c.label)).toContain("Background");
  });

  test("an unknown component with no descriptor still gets a usable set", () => {
    const { controls } = resolveControls({ node: { $ref: "Mystery" } });
    expect(controls.length).toBeGreaterThan(0);
  });
});

describe("theme vocabularies", () => {
  const theme = {
    name: "t",
    colors: {
      background: "oklch(1 0 0)",
      primary: { DEFAULT: "oklch(.5 .2 264)", foreground: "oklch(1 0 0)" },
    },
    typography: { fontFamily: { sans: "Inter", mono: "JetBrains Mono" } },
    spacing: {},
    radius: {},
  } as unknown as Parameters<typeof colorChoices>[0];

  test("flattens colour groups into the tokens the style model stores", () => {
    expect(colorChoices(theme).map((c) => c.value)).toEqual([
      "background",
      "primary",
      "primary-foreground",
    ]);
  });

  test("offers font roles, never raw families", () => {
    expect(fontChoices(theme).map((c) => c.value)).toEqual(["sans", "mono"]);
  });

  test("survives a missing theme", () => {
    expect(colorChoices(null)).toEqual([]);
    expect(fontChoices(undefined)).toEqual([]);
  });

  test("a swatch paints the design's colour, not whatever --color-primary means here", () => {
    expect(resolveColorToken(theme, "primary")).toBe("oklch(.5 .2 264)");
    expect(resolveColorToken(theme, "primary-foreground")).toBe("oklch(1 0 0)");
    expect(resolveColorToken(theme, "background")).toBe("oklch(1 0 0)");
    // Every choice carries its own resolved colour so the grid doesn't re-resolve.
    expect(colorChoices(theme).map((c) => c.swatch)).toEqual([
      "oklch(1 0 0)",
      "oklch(.5 .2 264)",
      "oklch(1 0 0)",
    ]);
  });

  test("an opacity modifier is not part of the token, and a literal is already a colour", () => {
    expect(resolveColorToken(theme, "primary/10")).toBe("oklch(.5 .2 264)");
    expect(resolveColorToken(theme, "[#7c3aed]")).toBe("#7c3aed");
  });

  test("a token the theme never declared resolves to nothing, not to a wrong colour", () => {
    expect(resolveColorToken(theme, "blue-500")).toBeNull();
    expect(resolveColorToken(theme, null)).toBeNull();
  });
});
