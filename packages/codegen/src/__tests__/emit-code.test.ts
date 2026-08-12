import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@velloo/schema";
import { emitCode } from "../emit-code/index.ts";

function buildWelcomePage(): Page {
  return {
    name: "Welcome",
    variants: [
      {
        id: "mobile",
        name: "Mobile",
        viewport: { w: 390, h: 844 },
        tree: {
          $ref: "Card",
          props: { className: "p-6 flex flex-col gap-6" },
          children: [
            {
              $ref: "Heading",
              props: { level: 1, children: "Velloo" },
            },
            {
              $ref: "Badge",
              props: { variant: "secondary", children: "v0" },
            },
            {
              $ref: "Text",
              props: { variant: "muted", children: "Design tool for shadcn." },
            },
            { $ref: "Separator", props: {} },
            { $ref: "Label", props: { htmlFor: "email", children: "Email" } },
            {
              $ref: "Input",
              props: { id: "email", type: "email", placeholder: "you@example.com" },
            },
            {
              $ref: "Button",
              props: { variant: "default", children: "Continue" },
            },
          ],
        },
      },
    ],
  };
}

describe("emitCode", () => {
  test("emits a syntactically valid, importable .tsx for the welcome variant", async () => {
    const out = join(tmpdir(), `velloo-emit-${Date.now()}.tsx`);
    const result = await emitCode(buildWelcomePage(), {
      variantId: "mobile",
      outputPath: out,
      apply: false,
    });

    expect(result.errors).toEqual([]);
    expect(result.applied).toBe(false);

    // Imports: every shadcn component used should have an import grouped by file.
    expect(result.code).toContain(`from "@/components/ui/badge"`);
    expect(result.code).toContain(`from "@/components/ui/button"`);
    expect(result.code).toContain(`from "@/components/ui/card"`);
    expect(result.code).toContain(`from "@/components/ui/input"`);
    expect(result.code).toContain(`from "@/components/ui/label"`);
    expect(result.code).toContain(`from "@/components/ui/separator"`);

    // Velloo-owned typography is lowered to plain HTML.
    expect(result.code).toContain("<h1");
    expect(result.code).toContain("<p");
    expect(result.code).not.toContain('from "@/components/ui/heading"');
    expect(result.code).not.toContain('from "@/components/ui/text"');

    // Lowered props (level, variant) get consumed and stripped.
    expect(result.code).not.toMatch(/level=\{1\}/);
    expect(result.code).not.toMatch(/variant="muted"/);

    // Default export named after the page + variant.
    expect(result.code).toContain("export default function WelcomeMobile()");

    // Children strings appear as JSX text.
    expect(result.code).toContain("Velloo");
    expect(result.code).toContain("Continue");
  }, 30_000);

  test("returns a diff but does not write when apply is false", async () => {
    const out = join(tmpdir(), `velloo-emit-noapply-${Date.now()}.tsx`);
    const result = await emitCode(buildWelcomePage(), {
      variantId: "mobile",
      outputPath: out,
      apply: false,
    });
    expect(result.applied).toBe(false);
    expect(result.diff.exists).toBe(false);
    expect(typeof result.diff.diff).toBe("string");
    expect(result.diff.diff.length).toBeGreaterThan(0);
  }, 30_000);

  test("writes the file when apply is true", async () => {
    const out = join(tmpdir(), `velloo-emit-apply-${Date.now()}.tsx`);
    const result = await emitCode(buildWelcomePage(), {
      variantId: "mobile",
      outputPath: out,
      apply: true,
    });
    expect(result.errors).toEqual([]);
    expect(result.applied).toBe(true);
    const onDisk = await Bun.file(out).text();
    expect(onDisk).toBe(result.code);
  }, 30_000);

  test("throws VariantNotFoundError for an unknown variant id", async () => {
    await expect(
      emitCode(buildWelcomePage(), {
        variantId: "tablet",
        outputPath: join(tmpdir(), "x.tsx"),
        apply: false,
      }),
    ).rejects.toThrow(/Variant not found/);
  });
});
