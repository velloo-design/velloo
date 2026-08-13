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

  // ----- Round-3 false-positive regression: structural utilities are NOT color -----

  test("doesn't flag structural border-side or border-width classes", async () => {
    await loadWith({
      name: "P",
      variants: [
        {
          id: "v",
          name: "V",
          viewport: { w: 390, h: 844 },
          tree: {
            $ref: "Card",
            props: { className: "border-b border-t border-2 border-0 border-dashed border-solid" },
          },
        },
      ],
    });
    const result = await darkModeAudit(ctx, { pageId: "p", variantId: "v" });
    if (!result.ok) throw new Error("expected ok");
    // None of these touch color.
    expect(result.value.totalColored).toBe(0);
    expect(result.value.problems).toHaveLength(0);
    expect(result.value.coverage).toBe(1);
  });

  test("doesn't flag structural ring/shadow/text-size utilities", async () => {
    await loadWith({
      name: "P",
      variants: [
        {
          id: "v",
          name: "V",
          viewport: { w: 390, h: 844 },
          tree: {
            $ref: "Card",
            props: {
              className:
                "ring-0 ring-2 ring-inset shadow-none shadow-sm shadow-md shadow-lg text-xs text-sm text-base text-lg text-5xl text-center text-left font-medium leading-tight tracking-tight",
            },
          },
        },
      ],
    });
    const result = await darkModeAudit(ctx, { pageId: "p", variantId: "v" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.totalColored).toBe(0);
    expect(result.value.problems).toHaveLength(0);
  });

  test("does flag genuine color uses on the same prefixes", async () => {
    await loadWith({
      name: "P",
      variants: [
        {
          id: "v",
          name: "V",
          viewport: { w: 390, h: 844 },
          tree: {
            $ref: "Card",
            props: {
              className:
                "border-b border-zinc-300 ring-2 ring-blue-500 shadow-md shadow-zinc-500/20",
            },
          },
        },
      ],
    });
    const result = await darkModeAudit(ctx, { pageId: "p", variantId: "v" });
    if (!result.ok) throw new Error("expected ok");
    const root = result.value.problems[0];
    // border-b, ring-2, shadow-md are structural — only the color forms get flagged.
    expect(root?.raw).toEqual(["border-zinc-300", "ring-blue-500", "shadow-zinc-500/20"]);
    expect(root?.suggestions["border-zinc-300"]).toBe("border-border");
    expect(root?.suggestions["ring-blue-500"]).toBe("ring-ring");
  });

  test("treats transparent / current / inherit as non-flagging color literals", async () => {
    await loadWith({
      name: "P",
      variants: [
        {
          id: "v",
          name: "V",
          viewport: { w: 390, h: 844 },
          tree: {
            $ref: "Card",
            props: { className: "bg-transparent text-current border-transparent" },
          },
        },
      ],
    });
    const result = await darkModeAudit(ctx, { pageId: "p", variantId: "v" });
    if (!result.ok) throw new Error("expected ok");
    // These ARE color-related but intentionally non-flipping — don't flag.
    expect(result.value.problems).toHaveLength(0);
  });

  test("filters arbitrary values: bg-[#hex] is color (flagged), grid-cols-[80px_1fr] isn't even considered", async () => {
    await loadWith({
      name: "P",
      variants: [
        {
          id: "v",
          name: "V",
          viewport: { w: 390, h: 844 },
          tree: {
            $ref: "Card",
            props: {
              className: "grid-cols-[80px_1fr] bg-[#fa00ff] text-[oklch(0.5_0.2_250)]",
            },
          },
        },
      ],
    });
    const result = await darkModeAudit(ctx, { pageId: "p", variantId: "v" });
    if (!result.ok) throw new Error("expected ok");
    const root = result.value.problems[0];
    expect(root?.raw).toContain("bg-[#fa00ff]");
    expect(root?.raw).toContain("text-[oklch(0.5_0.2_250)]");
    expect(root?.raw).not.toContain("grid-cols-[80px_1fr]");
  });

  test("realistic page: ~98% semantic + a couple intentional ring/shadow utilities = coverage 1.0", async () => {
    // Simulates a page where every color use is semantic, plus structural
    // non-color utilities (ring-0, shadow-none, border-b, text-xl). The
    // round-3 feedback got coverage 0.54 here — should now be 1.0.
    await loadWith({
      name: "P",
      variants: [
        {
          id: "v",
          name: "V",
          viewport: { w: 390, h: 844 },
          tree: {
            $ref: "Card",
            props: { className: "bg-background text-foreground border-b ring-0 shadow-none p-6" },
            children: [
              {
                $ref: "Heading",
                props: { level: 1, className: "text-foreground text-5xl", children: "x" },
              },
              {
                $ref: "Text",
                props: { className: "text-muted-foreground text-sm", children: "y" },
              },
              {
                $ref: "Card",
                props: {
                  className:
                    "bg-card border-border shadow-md border-2 rounded-xl px-4 py-3 ring-2 ring-ring",
                },
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
  });

  // ----- Round-5: data-accent intentional opt-out -----

  test("data-accent exempts a node from the audit entirely", async () => {
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
              // Brand gradient — intentional non-flipping accent.
              {
                $ref: "Card",
                props: {
                  className: "bg-gradient-to-br from-violet-600 to-rose-500 p-8",
                  "data-accent": "brand",
                },
              },
              // Regular text — flips normally.
              { $ref: "Text", props: { className: "text-foreground", children: "y" } },
            ],
          },
        },
      ],
    });
    const result = await darkModeAudit(ctx, { pageId: "p", variantId: "v" });
    if (!result.ok) throw new Error("expected ok");
    // The accent card is invisible to the audit; only root Card + Text count.
    expect(result.value.totalColored).toBe(2);
    expect(result.value.problems).toHaveLength(0);
    expect(result.value.coverage).toBe(1);
  });

  test("data-accent: false / empty string / null are NOT opt-outs (must be truthy)", async () => {
    await loadWith({
      name: "P",
      variants: [
        {
          id: "v",
          name: "V",
          viewport: { w: 390, h: 844 },
          tree: {
            $ref: "Card",
            props: { className: "bg-zinc-900", "data-accent": false },
          },
        },
      ],
    });
    const result = await darkModeAudit(ctx, { pageId: "p", variantId: "v" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.problems).toHaveLength(1);
  });

  test("auditSnippet runs the same audit against a snippet body", async () => {
    // Set up a snippet on disk in addition to the page.
    const { mkdir } = await import("node:fs/promises");
    await loadWith({
      name: "P",
      variants: [
        {
          id: "v",
          name: "V",
          viewport: { w: 390, h: 844 },
          tree: { $ref: "Card" },
        },
      ],
    });
    await mkdir(join(tmp, "snippets"), { recursive: true });
    await writeFile(
      join(tmp, "snippets/bad.json"),
      JSON.stringify({
        id: "bad",
        name: "Bad",
        params: [],
        tree: {
          $ref: "Card",
          props: { className: "bg-zinc-900 text-white" },
        },
      }),
      "utf8",
    );
    folder = await loadDesignFolder(tmp);
    ctx = { folder, broadcast: () => {} };

    const { auditSnippet } = await import("../index.ts");
    const result = await auditSnippet(ctx, { snippetId: "bad" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.problems).toHaveLength(1);
    expect(result.value.problems[0]?.raw).toEqual(["bg-zinc-900", "text-white"]);
  });

  test("data-accent on a wrapper does NOT cascade to children", async () => {
    await loadWith({
      name: "P",
      variants: [
        {
          id: "v",
          name: "V",
          viewport: { w: 390, h: 844 },
          tree: {
            $ref: "Card",
            props: {
              className: "bg-gradient-to-br from-violet-600 to-rose-500",
              "data-accent": "ok",
            },
            children: [
              // Child text uses raw color — should still be flagged.
              { $ref: "Text", props: { className: "text-zinc-200", children: "y" } },
            ],
          },
        },
      ],
    });
    const result = await darkModeAudit(ctx, { pageId: "p", variantId: "v" });
    if (!result.ok) throw new Error("expected ok");
    // Root is exempt; child is not.
    expect(result.value.problems).toHaveLength(1);
    expect(result.value.problems[0]?.ref).toBe("Text");
  });
});
