import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { designTheme } from "../../testing/design-folder.ts";
import { recipeForSpecifier, recipesForHost } from "../recipes/index.ts";
import { mantineRecipe } from "../recipes/mantine.ts";

/**
 * The recipe contract, without the library installed. Every other Mantine suite
 * needs the modeleval fixture and skips itself where that isn't present —
 * which is CI, so until this file existed the whole adapter-less path shipped
 * on a green board that had never run it.
 */
describe("framework recipes", () => {
  test("a recipe speaks for its packages, and for nothing else", () => {
    expect(recipeForSpecifier("@mantine/core")?.id).toBe("mantine");
    expect(recipeForSpecifier("@mantine/core/styles.css")?.id).toBe("mantine");
    expect(recipeForSpecifier("@mantine/dates")?.id).toBe("mantine");
    expect(recipeForSpecifier("@mui/material")).toBeUndefined();
    expect(recipeForSpecifier("./src/components")).toBeUndefined();
  });

  test("a host is offered a recipe only when it has that library installed", async () => {
    const root = await mkdtemp(join(tmpdir(), "velloo-recipes-"));
    expect(recipesForHost(root)).toEqual([]);
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "app" }));
    expect(recipesForHost(root)).toEqual([]);
  });

  test("the preview entry links the app's own copies, or declines", () => {
    // Every specifier resolvable: the wrapper imports the stylesheet first, so
    // components never paint a frame unstyled, and the app's React — one copy,
    // or hooks throw across the boundary.
    const resolved = mantineRecipe.previewModule((specifier) => `/app/node_modules/${specifier}`);
    expect(resolved).toContain('import "/app/node_modules/@mantine/core/styles.css"');
    expect(resolved).toContain('import * as React from "/app/node_modules/react"');
    expect(resolved).toContain("MantineProvider");
    expect(resolved).toContain("createTheme(props.recipeTheme || {})");
    // An optional stylesheet the app doesn't have is simply left out.
    const core = mantineRecipe.previewModule((specifier) =>
      specifier.startsWith("@mantine/dates") ? null : `/app/node_modules/${specifier}`,
    );
    expect(core).not.toContain("@mantine/dates");
    expect(core).toContain("@mantine/core/styles.css");
    // Missing the library itself ⇒ no wrapper at all, rather than a broken one.
    expect(mantineRecipe.previewModule(() => null)).toBeNull();
  });

  test("an adaptation is keyed by the exact component, never inherited by a part", () => {
    // `Menu` opens inside the frame; `Menu.Item` is an ordinary child, and
    // handing it `withinPortal` would pass an unknown prop to the DOM.
    expect(mantineRecipe.adaptations.Menu?.props).toMatchObject({ withinPortal: false });
    expect(mantineRecipe.adaptations["Menu.Item"]).toBeUndefined();
    expect(mantineRecipe.adaptations["Menu.Dropdown"]).toBeUndefined();
    // A combobox takes it nested, not at the top level.
    expect(mantineRecipe.adaptations.Select?.props).toEqual({
      comboboxProps: { withinPortal: false, transitionProps: { duration: 0 } },
    });
    // An overlay that would trap focus or lock scrolling does neither here.
    expect(mantineRecipe.adaptations.Modal?.props).toMatchObject({
      trapFocus: false,
      lockScroll: false,
    });
    for (const [key, adaptation] of Object.entries(mantineRecipe.adaptations)) {
      expect(adaptation.note.length, `${key} explains itself`).toBeGreaterThan(0);
    }
  });

  test("the stylesheet probe only passes when the stylesheet actually loaded", () => {
    const probe = mantineRecipe.stylesheetProbe;
    if (!probe) throw new Error("the recipe must probe for its stylesheet");
    // The rule under test is Mantine's own: without styles.css the element is
    // visible, so an unstyled render can't be reported exact.
    expect(probe.html).toContain("mantine-light-hidden");
    expect(probe.selector).toBe(".mantine-light-hidden");
    expect(probe.property).toBe("display");
    expect(probe.expect).toBe("none");
    expect(probe.stylesheet).toBe("@mantine/core/styles.css");
  });

  test("the theme carries the design's primary as Mantine's filled shade", () => {
    const theme = designTheme({
      colors: { primary: { DEFAULT: "oklch(0.55 0.18 280)", foreground: "oklch(0.985 0 0)" } },
      radius: { md: "0.5rem" },
      typography: { fontFamily: { sans: "Inter, sans-serif", display: "Fraunces, serif" } },
    } as never);
    const native = mantineRecipe.themeToNative(theme, false) as {
      colors: { velloo: string[] };
      primaryColor: string;
      primaryShade: unknown;
      fontFamily?: string;
      headings?: { fontFamily?: string };
      defaultRadius?: number;
    };
    expect(native.primaryColor).toBe("velloo");
    // Ten shades, hex, with the design's own colour at the filled index.
    expect(native.colors.velloo).toHaveLength(10);
    expect(native.colors.velloo.every((shade) => /^#[0-9a-f]{6}$/i.test(shade))).toBe(true);
    // The design's own colour sits at the filled shade, untouched — that is
    // what makes `color="velloo"` match the design rather than approximate it.
    expect(native.primaryShade).toEqual({ light: 6, dark: 6 });
    // oklch(0.55 0.18 280) in hex: the token itself, not a nearby approximation.
    expect(native.colors.velloo[6]).toBe("#615ed6");
    // A ramp around it: strictly darker as the index grows, so a component
    // asking for shade 2 gets a tint of the design's colour rather than a copy.
    const lightness = native.colors.velloo.map((shade) => {
      const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(shade.slice(at, at + 2), 16));
      return 0.2126 * (r as number) + 0.7152 * (g as number) + 0.0722 * (b as number);
    });
    expect(lightness.every((value, i) => i === 0 || value < (lightness[i - 1] as number))).toBe(
      true,
    );
    expect(native.fontFamily).toContain("Inter");
    // A display face is Mantine's heading family; radius crosses rem → px.
    expect(native.headings?.fontFamily).toContain("Fraunces");
    expect(native.defaultRadius).toBe(8);
  });

  test("dark mode is a different theme, not the same one relabelled", () => {
    const theme = designTheme();
    const light = JSON.stringify(mantineRecipe.themeToNative(theme, false));
    const dark = JSON.stringify(mantineRecipe.themeToNative(theme, true));
    expect(light).not.toBe(dark);
  });
});
