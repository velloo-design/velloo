import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@velloo/schema";
import { type DesignFolder, loadDesignFolder } from "../../design-folder.ts";
import type { WatchEvent } from "../../watcher.ts";
import { applyClassesBulk, type MutationContext, updatePropsBulk } from "../index.ts";

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

const samplePage: Page = {
  name: "P",
  variants: [
    {
      id: "mobile",
      name: "Mobile",
      viewport: { w: 390, h: 844 },
      tree: {
        $ref: "Card",
        children: [
          { $ref: "Heading", props: { level: 1, children: "A", className: "text-zinc-900" } },
          { $ref: "Text", props: { children: "B", className: "text-zinc-500" } },
          { $ref: "Button", props: { children: "C", className: "bg-zinc-900 text-white" } },
        ],
      },
    },
  ],
};

let tmp: string;
let folder: DesignFolder;
let ctx: MutationContext;
let broadcasts: WatchEvent[];

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-bulk-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(tmp, ".design"), { recursive: true });
  await mkdir(join(tmp, "theme"), { recursive: true });
  await mkdir(join(tmp, "pages"), { recursive: true });
  await writeFile(join(tmp, ".design/config.json"), JSON.stringify(sampleConfig), "utf8");
  await writeFile(join(tmp, "theme/default.json"), JSON.stringify(sampleTheme), "utf8");
  await writeFile(join(tmp, "pages/p.json"), JSON.stringify(samplePage), "utf8");
  folder = await loadDesignFolder(tmp);
  broadcasts = [];
  ctx = { folder, broadcast: (e) => broadcasts.push(e) };
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("applyClassesBulk", () => {
  test("applies all patches and broadcasts page-changed once", async () => {
    const r = await applyClassesBulk(ctx, {
      pageId: "p",
      variantId: "mobile",
      patches: [
        { path: [0], classes: "text-foreground" },
        { path: [1], classes: "text-muted-foreground" },
        { path: [2], classes: "bg-primary text-primary-foreground" },
      ],
    });
    if (!r.ok) throw new Error(`expected ok: ${JSON.stringify(r.error)}`);
    expect(r.value.paths).toEqual([[0], [1], [2]]);
    expect(broadcasts.filter((b) => b.type === "page-changed")).toHaveLength(1);
    const onDisk = JSON.parse(await readFile(join(tmp, "pages/p.json"), "utf8")) as Page;
    const root = onDisk.variants[0]?.tree;
    if (!root || !("$ref" in root)) throw new Error("expected root");
    const ch = root.children ?? [];
    function classNameOf(idx: number): string {
      const n = ch[idx];
      if (!n || !("$ref" in n)) return "";
      return (n.props?.className as string) ?? "";
    }
    expect(classNameOf(0)).toBe("text-foreground");
    expect(classNameOf(1)).toBe("text-muted-foreground");
    expect(classNameOf(2)).toBe("bg-primary text-primary-foreground");
  });

  test("rejects with InvalidPath if any patch points at a missing node — partial application avoided", async () => {
    const r = await applyClassesBulk(ctx, {
      pageId: "p",
      variantId: "mobile",
      patches: [
        { path: [0], classes: "text-foreground" },
        { path: [99], classes: "boom" },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("InvalidPath");
    // First patch shouldn't have landed on disk.
    const onDisk = JSON.parse(await readFile(join(tmp, "pages/p.json"), "utf8")) as Page;
    const root = onDisk.variants[0]?.tree;
    if (!root || !("$ref" in root)) throw new Error("expected root");
    const first = root.children?.[0];
    if (!first || !("$ref" in first)) throw new Error("expected component");
    expect(first.props?.className).toBe("text-zinc-900");
  });
});

describe("updatePropsBulk", () => {
  test("merges props on every targeted node atomically", async () => {
    const r = await updatePropsBulk(ctx, {
      pageId: "p",
      variantId: "mobile",
      patches: [
        { path: [0], propPatch: { level: 2 } },
        { path: [1], propPatch: { children: "B'" } },
      ],
    });
    if (!r.ok) throw new Error("expected ok");
    const onDisk = JSON.parse(await readFile(join(tmp, "pages/p.json"), "utf8")) as Page;
    const root = onDisk.variants[0]?.tree;
    if (!root || !("$ref" in root)) throw new Error("expected root");
    const ch = root.children ?? [];
    function propOf(idx: number, key: string): unknown {
      const n = ch[idx];
      if (!n || !("$ref" in n)) return undefined;
      return n.props?.[key];
    }
    expect(propOf(0, "level")).toBe(2);
    expect(propOf(1, "children")).toBe("B'");
  });
});
