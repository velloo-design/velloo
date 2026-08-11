import { describe, expect, test } from "bun:test";
import { ConfigSchema, NodeSchema, PageSchema, ThemeSchema, VariantSchema } from "../index.ts";

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
