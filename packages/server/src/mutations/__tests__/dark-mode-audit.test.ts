import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@velloo/schema";
import { type DesignFolder, loadDesignFolder } from "../../design-folder.ts";
import { darkModeAudit, type MutationContext } from "../index.ts";

const sampleConfig = {
  schemaVersion: 1,
  toolVersion: "0.1.0",
  componentSource: { framework: "shadcn-react", snapshotVersion: "test" },
  viewportPresets: [{ name: "Mobile", w: 390, h: 844 }],
};

const sampleTheme = {
  name: "default",
  colors: {
    background: "oklch(1 0 0)",
    foreground: "oklch(0 0 0)",
    primary: { DEFAULT: "oklch(0.205 0 0)", foreground: "oklch(0.985 0 0)" },
  },
  typography: {},
  spacing: {},
  radius: {},
};

let tmp: string;
let folder: DesignFolder;
let ctx: MutationContext;

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-dark-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(tmp, ".design"), { recursive: true });
  await mkdir(join(tmp, "theme"), { recursive: true });
  await mkdir(join(tmp, "pages"), { recursive: true });
  await writeFile(join(tmp, ".design/config.json"), JSON.stringify(sampleConfig), "utf8");
  await writeFile(join(tmp, "theme/default.json"), JSON.stringify(sampleTheme), "utf8");
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function loadWith(page: Page): Promise<void> {
  await writeFile(join(tmp, "pages/p.json"), JSON.stringify(page), "utf8");
  folder = await loadDesignFolder(tmp);
  ctx = { folder, broadcast: () => {} };
}

describe("darkModeAudit", () => {
  test("returns coverage 1 and no problems when every node uses semantic tokens", async () => {
    await loadWith({
      name: "P",
      variants: [
        {
          id: "v",
          name: "V",
          viewport: { w: 390, h: 844 },
          tree: {
            $ref: "Card",
            props: { className: "bg-card text-foreground border-border p-6" },
            children: [
              {
                $ref: "Heading",
                props: { level: 1, className: "text-foreground", children: "Welcome" },
              },
            ],
          },
        },
      ],
    });
    const result = await darkModeAudit(ctx, { pageId: "p", variantId: "v" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.coverage).toBe(1);
    expect(result.value.problems).toHaveLength(0);
    expect(result.value.totalColored).toBe(2);
  });

  test("flags raw palette colors and suggests semantic equivalents", async () => {
    await loadWith({
      name: "P",
      variants: [
        {
          id: "v",
          name: "V",
          viewport: { w: 390, h: 844 },
          tree: {
            $ref: "Card",
            props: { className: "bg-zinc-950 text-zinc-100 border-zinc-800 p-6" },
            children: [
              {
                $ref: "Text",
                props: { className: "text-emerald-400", children: "Accent" },
              },
            ],
          },
        },
      ],
    });
    const result = await darkModeAudit(ctx, { pageId: "p", variantId: "v" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.coverage).toBe(0);
    expect(result.value.problems).toHaveLength(2);
    const root = result.value.problems.find((p) => p.ref === "Card");
    expect(root?.raw).toContain("bg-zinc-950");
    expect(root?.raw).toContain("text-zinc-100");
    expect(root?.suggestions["bg-zinc-950"]).toBe("bg-background");
    expect(root?.suggestions["text-zinc-100"]).toBe("text-foreground");
    expect(root?.suggestions["border-zinc-800"]).toBe("border-border");
  });

  test("treats arbitrary-value colors (bg-[#fa00ff]) as raw", async () => {
    await loadWith({
      name: "P",
      variants: [
        {
          id: "v",
          name: "V",
          viewport: { w: 390, h: 844 },
          tree: {
            $ref: "Card",
            props: { className: "bg-[#fa00ff] p-6" },
          },
        },
      ],
    });
    const result = await darkModeAudit(ctx, { pageId: "p", variantId: "v" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.problems[0]?.raw).toContain("bg-[#fa00ff]");
  });

  test("ignores nodes that don't touch color (pure layout)", async () => {
    await loadWith({
      name: "P",
      variants: [
        {
          id: "v",
          name: "V",
          viewport: { w: 390, h: 844 },
          tree: {
            $ref: "Card",
            props: { className: "p-6 flex flex-col gap-4" },
            children: [{ $ref: "Heading", props: { children: "x" } }],
          },
        },
      ],
    });
    const result = await darkModeAudit(ctx, { pageId: "p", variantId: "v" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.totalColored).toBe(0);
    expect(result.value.coverage).toBe(1);
  });

  test("mixes: partial coverage when some nodes are semantic and some raw", async () => {
    await loadWith({
      name: "P",
      variants: [
        {
          id: "v",
          name: "V",
          viewport: { w: 390, h: 844 },
          tree: {
            $ref: "Card",
            props: { className: "bg-card p-6" },
            children: [
              { $ref: "Text", props: { className: "text-zinc-500", children: "x" } },
              { $ref: "Text", props: { className: "text-foreground", children: "y" } },
            ],
          },
        },
      ],
    });
    const result = await darkModeAudit(ctx, { pageId: "p", variantId: "v" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.totalColored).toBe(3);
    expect(result.value.problems).toHaveLength(1);
    // 2 of 3 colored nodes are semantic.
    expect(result.value.coverage).toBeCloseTo(2 / 3, 5);
  });

  test("preserves dark: variant prefix in suggestions", async () => {
    await loadWith({
      name: "P",
      variants: [
        {
          id: "v",
          name: "V",
          viewport: { w: 390, h: 844 },
          tree: {
            $ref: "Card",
            props: { className: "bg-white dark:bg-zinc-900 p-6" },
          },
        },
      ],
    });
    const result = await darkModeAudit(ctx, { pageId: "p", variantId: "v" });
    if (!result.ok) throw new Error("expected ok");
    const root = result.value.problems[0];
    expect(root?.suggestions["bg-white"]).toBe("bg-card");
    // dark:bg-zinc-900 should keep its variant prefix in the suggestion.
    expect(root?.suggestions["dark:bg-zinc-900"]).toBe("dark:bg-muted");
  });
});
