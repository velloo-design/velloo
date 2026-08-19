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
