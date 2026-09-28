import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { extraThemeBlock } from "../index.ts";
import { TailwindJit } from "../styles/tailwind-jit.ts";
import { testContext } from "../testing/design-folder.ts";

/**
 * A design system's t-shirt spacing must not resize Tailwind's size scale.
 *
 * DESIGN.md files name spacing `xs`…`2xl`. Tailwind v4 resolves `max-w-xl`
 * through `--spacing-xl` before `--container-xl`, so emitting those names
 * turned the route placeholders' `max-w-xl` paragraph into a 24px column —
 * one word per line. This compiles the placeholder's own classes against the
 * folder's real `@theme` block.
 */

/** The classes `velloo init` puts on a route placeholder (cli scan/generate-screens.ts). */
const PLACEHOLDER_CLASSES = ["max-w-xl", "mt-4 w-full max-w-2xl text-left"];

let harness: Awaited<ReturnType<typeof testContext>>;
let css: string;

beforeAll(async () => {
  harness = await testContext({
    label: "spacing-sizes",
    theme: {
      spacing: {
        xs: "0.25rem",
        sm: "0.5rem",
        md: "0.75rem",
        lg: "1rem",
        xl: "1.5rem",
        "2xl": "2rem",
        gutter: "1rem",
      },
    },
    screens: {
      index: {
        id: "index",
        name: "Home",
        tree: {
          $ref: "Box",
          props: { className: "p-gutter" },
          children: PLACEHOLDER_CLASSES.map((className) => ({
            $ref: "Text",
            props: { className, children: "Placeholder copy." },
          })),
        },
      },
    },
  });
  const { folder, ctx } = harness;
  css = await new TailwindJit(ctx.defaultProvider, join(folder.root, "screens"), undefined, () =>
    extraThemeBlock(folder),
  ).build();
});

afterAll(() => harness?.cleanup());

describe("theme spacing named like Tailwind sizes", () => {
  test("the folder's @theme block leaves the size names to Tailwind", () => {
    const block = extraThemeBlock(harness.folder);
    for (const name of ["xs", "sm", "md", "lg", "xl", "2xl"]) {
      expect(block).not.toContain(`--spacing-${name}:`);
    }
    expect(block).toContain("--spacing-gutter:");
  });

  test("max-w-xl and max-w-2xl keep their container widths", () => {
    const rule = (cls: string) => new RegExp(`\\.${cls}\\s*\\{[^}]*\\}`).exec(css)?.[0] ?? "";
    expect(rule("max-w-xl")).toContain("--container-xl");
    expect(rule("max-w-2xl")).toContain("--container-2xl");
    expect(css).not.toContain("var(--spacing-xl)");
  });

  test("a spacing token with its own name still compiles", () => {
    expect(css).toMatch(/\.p-gutter\s*\{[^}]*--spacing-gutter/);
  });
});
