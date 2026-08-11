import { describe, expect, test } from "bun:test";
import { isKnownComponent, loadCss, loadManifest, registry, snapshotVersion } from "../index.ts";

describe("registry", () => {
  test("has the 8 starter components plus Card subcomponents", () => {
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

  test("isKnownComponent matches registry membership", () => {
    expect(isKnownComponent("Button")).toBe(true);
    expect(isKnownComponent("DefinitelyNotReal")).toBe(false);
  });
});

describe("snapshot artifacts", () => {
  test("snapshotVersion is set and non-empty", () => {
    expect(typeof snapshotVersion).toBe("string");
    expect(snapshotVersion.length).toBeGreaterThan(0);
  });

  test("loadCss returns a non-trivial Tailwind output", async () => {
    const css = await loadCss();
    expect(css.length).toBeGreaterThan(1000);
    expect(css).toMatch(/--tw-|tailwindcss|preflight/);
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
});
