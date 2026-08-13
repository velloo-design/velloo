import { describe, expect, test } from "bun:test";
import {
  ConfigSchema,
  isComponentNode,
  isParamRef,
  isSnippetInstance,
  NodeSchema,
  PageSchema,
  SnippetSchema,
  ThemeSchema,
  VariantSchema,
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
});

describe("VariantSchema", () => {
  test("accepts a valid variant", () => {
    const variant = {
      id: "mobile",
      name: "Mobile",
      viewport: { w: 390, h: 844 },
      tree: { $ref: "Card" },
    };
    expect(VariantSchema.safeParse(variant).success).toBe(true);
  });

  test("rejects a variant with non-positive viewport", () => {
    const variant = {
      id: "mobile",
      name: "Mobile",
      viewport: { w: 0, h: 844 },
      tree: { $ref: "Card" },
    };
    expect(VariantSchema.safeParse(variant).success).toBe(false);
  });
});

describe("PageSchema", () => {
  test("requires at least one variant", () => {
    expect(PageSchema.safeParse({ name: "Empty", variants: [] }).success).toBe(false);
  });
});

describe("ConfigSchema", () => {
  test("accepts a valid config", () => {
    const config = {
      schemaVersion: 1,
      toolVersion: "0.1.0",
      componentSource: { framework: "shadcn-react", snapshotVersion: "0.0.0-stub" },
      viewportPresets: [{ name: "Mobile", w: 390, h: 844 }],
    };
    expect(ConfigSchema.safeParse(config).success).toBe(true);
  });

  test("rejects an unknown framework", () => {
    const config = {
      schemaVersion: 1,
      toolVersion: "0.1.0",
      componentSource: { framework: "shadcn-vue", snapshotVersion: "0.0.0" },
      viewportPresets: [{ name: "Mobile", w: 390, h: 844 }],
    };
    expect(ConfigSchema.safeParse(config).success).toBe(false);
  });

  test("rejects schemaVersion other than 1", () => {
    const config = {
      schemaVersion: 2,
      toolVersion: "0.1.0",
      componentSource: { framework: "shadcn-react", snapshotVersion: "0.0.0" },
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
