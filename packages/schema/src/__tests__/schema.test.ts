import { describe, expect, test } from "bun:test";
import {
  BoardSchema,
  ConfigSchema,
  FrameSchema,
  isComponentNode,
  isParamRef,
  isSnippetInstance,
  NodeIdSchema,
  NodeSchema,
  nodeId,
  ScreenSchema,
  SnippetSchema,
  ThemeSchema,
} from "../index.ts";

describe("NodeSchema", () => {
  test("accepts a leaf node", () => {
    expect(NodeSchema.safeParse({ $ref: "Button", props: { variant: "default" } }).success).toBe(
      true,
    );
  });

  test("accepts a nested tree", () => {
    const tree = {
      $ref: "Card",
      children: [
        { $ref: "Heading", props: { level: 1, children: "Welcome" } },
        { $ref: "Button", props: { variant: "default", children: "Continue" } },
      ],
    };
    expect(NodeSchema.safeParse(tree).success).toBe(true);
  });

  test("rejects a node missing $ref", () => {
    expect(NodeSchema.safeParse({ props: {} }).success).toBe(false);
  });

  test("rejects a node with empty $ref", () => {
    expect(NodeSchema.safeParse({ $ref: "" }).success).toBe(false);
  });

  test("accepts a snippet instance node", () => {
    const node = { $snippet: "feature-card", args: { title: "Fast" } };
    const parsed = NodeSchema.safeParse(node);
    expect(parsed.success).toBe(true);
    expect(isSnippetInstance(node)).toBe(true);
    expect(isComponentNode(node)).toBe(false);
  });

  test("accepts a param-ref node (snippet body usage)", () => {
    const node = { $param: "title" };
    expect(NodeSchema.safeParse(node).success).toBe(true);
    expect(isParamRef(node)).toBe(true);
  });

  test("rejects empty $snippet / $param ids", () => {
    expect(NodeSchema.safeParse({ $snippet: "" }).success).toBe(false);
    expect(NodeSchema.safeParse({ $param: "" }).success).toBe(false);
  });

  test("type guards are mutually exclusive on canonical shapes", () => {
    const comp = { $ref: "Card" };
    const snip = { $snippet: "x" };
    const param = { $param: "y" };
    expect([isComponentNode(comp), isSnippetInstance(comp), isParamRef(comp)]).toEqual([
      true,
      false,
      false,
    ]);
    expect([isComponentNode(snip), isSnippetInstance(snip), isParamRef(snip)]).toEqual([
      false,
      true,
      false,
    ]);
    expect([isComponentNode(param), isSnippetInstance(param), isParamRef(param)]).toEqual([
      false,
      false,
      true,
    ]);
  });

  test("accepts optional $id on component + snippet nodes; rejects bad formats", () => {
    expect(NodeSchema.safeParse({ $ref: "Card", $id: "hero-cta" }).success).toBe(true);
    expect(NodeSchema.safeParse({ $snippet: "x", $id: "hero_2" }).success).toBe(true);
    expect(NodeSchema.safeParse({ $ref: "Card", $id: "" }).success).toBe(false);
    expect(NodeSchema.safeParse({ $ref: "Card", $id: "1-leading-digit" }).success).toBe(false);
    expect(NodeSchema.safeParse({ $ref: "Card", $id: "has spaces" }).success).toBe(false);
    expect(NodeSchema.safeParse({ $ref: "Card", $id: "with.dot" }).success).toBe(false);
  });

  test("nodeId reads $id off any node kind safely", () => {
    expect(nodeId({ $ref: "Card", $id: "x" })).toBe("x");
    expect(nodeId({ $ref: "Card" })).toBeUndefined();
    expect(nodeId({ $snippet: "s", $id: "y" })).toBe("y");
    expect(nodeId({ $param: "z" })).toBeUndefined();
  });

  test("NodeIdSchema validates standalone id strings", () => {
    expect(NodeIdSchema.safeParse("ok-id").success).toBe(true);
    expect(NodeIdSchema.safeParse("Also_OK").success).toBe(true);
    expect(NodeIdSchema.safeParse("_starts-with-underscore").success).toBe(false);
    expect(NodeIdSchema.safeParse("a".repeat(65)).success).toBe(false);
  });
});

describe("SnippetSchema", () => {
  test("accepts a minimal snippet with no params", () => {
    const snippet = {
      id: "divider",
      name: "Divider",
      params: [],
      tree: { $ref: "Separator" },
    };
    expect(SnippetSchema.safeParse(snippet).success).toBe(true);
  });

  test("accepts a snippet with typed params and $param refs in the body", () => {
    const snippet = {
      id: "feature-card",
      name: "Feature Card",
      params: [
        { name: "title", type: "string" as const },
        { name: "body", type: "string" as const, default: "" },
      ],
      tree: {
        $ref: "Card",
        children: [
          { $ref: "Heading", props: { level: 3, children: { $param: "title" } } },
          { $ref: "Text", props: { children: { $param: "body" } } },
        ],
      },
    };
    expect(SnippetSchema.safeParse(snippet).success).toBe(true);
  });

  test("rejects empty id or name", () => {
    expect(
      SnippetSchema.safeParse({ id: "", name: "X", params: [], tree: { $ref: "Card" } }).success,
    ).toBe(false);
    expect(
      SnippetSchema.safeParse({ id: "x", name: "", params: [], tree: { $ref: "Card" } }).success,
    ).toBe(false);
  });

  test("rejects an unknown param type", () => {
    const bad = {
      id: "x",
      name: "X",
      params: [{ name: "y", type: "datetime" }],
      tree: { $ref: "Card" },
    };
    expect(SnippetSchema.safeParse(bad).success).toBe(false);
  });

  test("accepts icon, color, enum param types with their constraints", () => {
    const snippet = {
      id: "nav-row",
      name: "Nav row",
      params: [
        {
          name: "icon",
          type: "icon" as const,
          default: "Activity",
          description: "Lucide icon name",
        },
        { name: "tint", type: "color" as const, default: "#7c3aed" },
        {
          name: "size",
          type: "enum" as const,
          enum: ["sm", "md", "lg"],
          default: "md",
        },
        {
          name: "count",
          type: "number" as const,
          min: 0,
          max: 99,
          step: 1,
          default: 0,
        },
      ],
      tree: { $ref: "Card" },
    };
    const r = SnippetSchema.safeParse(snippet);
    expect(r.success).toBe(true);
  });
});

describe("ScreenSchema", () => {
  test("accepts a valid screen", () => {
    const screen = {
      id: "landing",
      name: "Landing",
      tree: { $ref: "Card", children: [{ $ref: "Heading", props: { children: "Hi" } }] },
    };
    expect(ScreenSchema.safeParse(screen).success).toBe(true);
  });

  test("rejects a screen without a tree", () => {
    expect(ScreenSchema.safeParse({ id: "x", name: "X" }).success).toBe(false);
  });
});

describe("FrameSchema", () => {
  test("accepts a valid frame", () => {
    const frame = {
      id: "f1",
      screen: "landing",
      x: 100,
      y: 100,
      w: 1440,
      h: 900,
    };
    expect(FrameSchema.safeParse(frame).success).toBe(true);
  });

  test("accepts a frame with label + group", () => {
    const frame = {
      id: "f2",
      screen: "landing",
      x: 0,
      y: 0,
      w: 390,
      h: 844,
      label: "Mobile",
      group: "marketing",
    };
    expect(FrameSchema.safeParse(frame).success).toBe(true);
  });

  test("rejects a frame with non-positive size", () => {
    expect(FrameSchema.safeParse({ id: "f", screen: "s", x: 0, y: 0, w: 0, h: 100 }).success).toBe(
      false,
    );
  });
});

describe("BoardSchema", () => {
  test("accepts a minimal board (id + name; frames and groups default to [])", () => {
    const parsed = BoardSchema.safeParse({ id: "app", name: "App" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.frames).toEqual([]);
      expect(parsed.data.groups).toEqual([]);
    }
  });

  test("rejects a board missing id + name (post-pivot: every board is identified)", () => {
    expect(BoardSchema.safeParse({}).success).toBe(false);
    expect(BoardSchema.safeParse({ id: "app" }).success).toBe(false);
    expect(BoardSchema.safeParse({ name: "App" }).success).toBe(false);
  });

  test("accepts a board with frames + groups", () => {
    const board = {
      id: "app",
      name: "App",
      frames: [{ id: "f1", screen: "landing", x: 0, y: 0, w: 390, h: 844 }],
      groups: [{ id: "marketing", name: "Marketing", color: "#7C3AED" }],
    };
    expect(BoardSchema.safeParse(board).success).toBe(true);
  });
});

describe("ConfigSchema", () => {
  test("accepts a valid config", () => {
    const config = {
      schemaVersion: 1,
      toolVersion: "0.1.0",
      library: {
        id: "shadcn-react",
        version: "2.3.4",
        source: "registry:shadcn",
        componentsPath: "components",
      },
      viewportPresets: [{ name: "Mobile", w: 390, h: 844 }],
    };
    expect(ConfigSchema.safeParse(config).success).toBe(true);
  });

  test("accepts experimental shared source", () => {
    const config = {
      schemaVersion: 1,
      toolVersion: "0.1.0",
      library: {
        id: "shadcn-react",
        version: "2.3.4",
        source: "shared:../apps/web/components",
        componentsPath: "../apps/web/components",
        experimental: "shared",
      },
      viewportPresets: [{ name: "Mobile", w: 390, h: 844 }],
    };
    expect(ConfigSchema.safeParse(config).success).toBe(true);
  });

  test("rejects an unknown framework", () => {
    const config = {
      schemaVersion: 1,
      toolVersion: "0.1.0",
      library: {
        id: "shadcn-vue",
        version: "2.3.4",
        source: "registry:shadcn",
        componentsPath: "components",
      },
      viewportPresets: [{ name: "Mobile", w: 390, h: 844 }],
    };
    expect(ConfigSchema.safeParse(config).success).toBe(false);
  });

  test("rejects schemaVersion other than 1", () => {
    const config = {
      schemaVersion: 2,
      toolVersion: "0.1.0",
      library: {
        id: "shadcn-react",
        version: "2.3.4",
        source: "registry:shadcn",
        componentsPath: "components",
      },
      viewportPresets: [{ name: "Mobile", w: 390, h: 844 }],
    };
    expect(ConfigSchema.safeParse(config).success).toBe(false);
  });
});

describe("ThemeSchema", () => {
  test("accepts a typed color theme", () => {
    const theme = {
      name: "default",
      colors: {
        background: "oklch(1 0 0)",
        foreground: "oklch(0.145 0 0)",
        primary: { DEFAULT: "oklch(0.205 0 0)", foreground: "oklch(0.985 0 0)" },
        secondary: { DEFAULT: "oklch(0.97 0 0)" },
        muted: "oklch(0.97 0 0)",
        border: "oklch(0.922 0 0)",
      },
      typography: { fontFamily: { sans: "Inter, sans-serif" }, fontSize: { base: 16 } },
      spacing: { 1: 4, 2: 8 },
      radius: { md: 8 },
    };
    expect(ThemeSchema.safeParse(theme).success).toBe(true);
  });

  test("rejects a theme without primary", () => {
    const theme = {
      name: "default",
      colors: { background: "oklch(1 0 0)", foreground: "oklch(0 0 0)" },
      typography: {},
      spacing: {},
      radius: {},
    };
    expect(ThemeSchema.safeParse(theme).success).toBe(false);
  });
});

describe("AnnotationSchema", () => {
  test("accepts an annotation with @id locator and auto position", async () => {
    const { AnnotationSchema } = await import("../annotation.ts");
    const parsed = AnnotationSchema.safeParse({
      id: "a1",
      target: { locator: "@hero-cta" },
      body: "**Important** — make this land harder.",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.position).toBe("auto"); // default
    }
  });

  test("accepts an annotation with path-array locator + explicit position", async () => {
    const { AnnotationSchema } = await import("../annotation.ts");
    const parsed = AnnotationSchema.safeParse({
      id: "a2",
      target: { locator: [0, 2, 1] },
      position: { x: -200, y: 40 },
      body: "x",
      collapsed: true,
    });
    expect(parsed.success).toBe(true);
  });

  test("rejects malformed @id locators", async () => {
    const { AnnotationSchema } = await import("../annotation.ts");
    expect(
      AnnotationSchema.safeParse({
        id: "a3",
        target: { locator: "1-bad-leading-digit" },
        body: "x",
      }).success,
    ).toBe(false);
    expect(
      AnnotationSchema.safeParse({
        id: "a4",
        target: { locator: "@" },
        body: "x",
      }).success,
    ).toBe(false);
  });
});

describe("CanvasNoteSchema", () => {
  test("accepts a note with required fields", async () => {
    const { CanvasNoteSchema } = await import("../annotation.ts");
    expect(
      CanvasNoteSchema.safeParse({
        id: "n1",
        x: 100,
        y: 200,
        width: 240,
        body: "# Intro\n\nFree text **here**.",
      }).success,
    ).toBe(true);
  });

  test("rejects a note with non-positive width", async () => {
    const { CanvasNoteSchema } = await import("../annotation.ts");
    expect(CanvasNoteSchema.safeParse({ id: "n2", x: 0, y: 0, width: 0, body: "" }).success).toBe(
      false,
    );
  });
});
