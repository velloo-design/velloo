import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@velloo/schema";
import { type DesignFolder, loadDesignFolder } from "../../design-folder.ts";
import {
  addNode,
  addVariant,
  applyClasses,
  inspect,
  type MutationContext,
  MutationError,
  moveNode,
  removeNode,
  updateProps,
} from "../index.ts";

const sampleConfig = {
  schemaVersion: 1,
  toolVersion: "0.1.0",
  componentSource: { framework: "shadcn-react", snapshotVersion: "test" },
  viewportPresets: [{ name: "Mobile", w: 390, h: 844 }],
};

const sampleTheme = {
  name: "default",
  colors: { background: "oklch(1 0 0)", foreground: "oklch(0 0 0)" },
  typography: {},
  spacing: {},
  radius: {},
};

const samplePage: Page = {
  name: "Onboarding",
  variants: [
    {
      id: "mobile",
      name: "Mobile",
      viewport: { w: 390, h: 844 },
      tree: {
        $ref: "Card",
        props: { className: "p-6" },
        children: [
          { $ref: "Heading", props: { level: 1, children: "Welcome" } },
          { $ref: "Text", props: { children: "Hello" } },
        ],
      },
    },
  ],
};

let tmp: string;
let folder: DesignFolder;

import type { WatchEvent } from "../../watcher.ts";

let broadcasts: WatchEvent[];
let ctx: MutationContext;

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readPage(): Promise<Page> {
  const raw = await readFile(join(tmp, "pages/onboarding.json"), "utf8");
  return JSON.parse(raw) as Page;
}

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-mut-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(tmp, ".design"), { recursive: true });
  await mkdir(join(tmp, "theme"), { recursive: true });
  await mkdir(join(tmp, "pages"), { recursive: true });
  await writeJson(join(tmp, ".design/config.json"), sampleConfig);
  await writeJson(join(tmp, "theme/default.json"), sampleTheme);
  await writeJson(join(tmp, "pages/onboarding.json"), samplePage);
  folder = await loadDesignFolder(tmp);
  broadcasts = [];
  ctx = {
    folder,
    broadcast: (e) => {
      broadcasts.push(e);
    },
  };
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("addNode", () => {
  test("appends a child to the root", async () => {
    const r = await addNode(ctx, {
      pageId: "onboarding",
      variantId: "mobile",
      parentPath: [],
      componentRef: "Button",
      props: { children: "Click" },
    });
    expect(r.path).toEqual([2]);
    const onDisk = await readPage();
    expect(onDisk.variants[0]?.tree.children).toHaveLength(3);
    expect(onDisk.variants[0]?.tree.children?.[2]?.$ref).toBe("Button");
    expect(broadcasts.at(-1)).toEqual({ type: "page-changed", pageId: "onboarding" });
  });

  test("inserts at index", async () => {
    const r = await addNode(ctx, {
      pageId: "onboarding",
      variantId: "mobile",
      parentPath: [],
      componentRef: "Badge",
      index: 1,
    });
    expect(r.path).toEqual([1]);
    const onDisk = await readPage();
    expect(onDisk.variants[0]?.tree.children?.[1]?.$ref).toBe("Badge");
  });

  test("rejects unknown component with suggestions", async () => {
    let err: MutationError | null = null;
    try {
      await addNode(ctx, {
        pageId: "onboarding",
        variantId: "mobile",
        parentPath: [],
        componentRef: "Buttn", // typo
      });
    } catch (e) {
      err = e as MutationError;
    }
    expect(err).toBeInstanceOf(MutationError);
    expect(err?.payload.code).toBe("UNKNOWN_COMPONENT");
    expect(err?.payload.suggestions).toContain("Button");
  });

  test("rejects out-of-range parentPath", async () => {
    await expect(
      addNode(ctx, {
        pageId: "onboarding",
        variantId: "mobile",
        parentPath: [99],
        componentRef: "Button",
      }),
    ).rejects.toBeInstanceOf(MutationError);
  });
});

describe("updateProps", () => {
  test("merges props and persists", async () => {
    const r = await updateProps(ctx, {
      pageId: "onboarding",
      variantId: "mobile",
      path: [0],
      propPatch: { level: 2, children: "Hi" },
    });
    expect(r.path).toEqual([0]);
    const onDisk = await readPage();
    expect(onDisk.variants[0]?.tree.children?.[0]?.props).toEqual({
      level: 2,
      children: "Hi",
    });
  });

  test("null in patch removes the key", async () => {
    await updateProps(ctx, {
      pageId: "onboarding",
      variantId: "mobile",
      path: [0],
      propPatch: { children: null },
    });
    const onDisk = await readPage();
    expect(onDisk.variants[0]?.tree.children?.[0]?.props).toEqual({ level: 1 });
  });
});

describe("removeNode", () => {
  test("removes a leaf and persists", async () => {
    const r = await removeNode(ctx, {
      pageId: "onboarding",
      variantId: "mobile",
      path: [0],
    });
    expect(r.removedRef).toBe("Heading");
    const onDisk = await readPage();
    expect(onDisk.variants[0]?.tree.children).toHaveLength(1);
    expect(onDisk.variants[0]?.tree.children?.[0]?.$ref).toBe("Text");
  });

  test("refuses to remove the root", async () => {
    await expect(
      removeNode(ctx, { pageId: "onboarding", variantId: "mobile", path: [] }),
    ).rejects.toBeInstanceOf(MutationError);
  });
});

describe("moveNode", () => {
  test("reorders within the same parent", async () => {
    const r = await moveNode(ctx, {
      pageId: "onboarding",
      variantId: "mobile",
      fromPath: [0],
      toParent: [],
      toIndex: 2,
    });
    expect(r.newPath).toEqual([1]); // splice-and-reinsert lands at end (index = length-1 after removal)
    const onDisk = await readPage();
    expect(onDisk.variants[0]?.tree.children?.[0]?.$ref).toBe("Text");
    expect(onDisk.variants[0]?.tree.children?.[1]?.$ref).toBe("Heading");
  });

  test("refuses to move into self", async () => {
    await expect(
      moveNode(ctx, {
        pageId: "onboarding",
        variantId: "mobile",
        fromPath: [],
        toParent: [],
      }),
    ).rejects.toBeInstanceOf(MutationError);
  });
});

describe("addVariant", () => {
  test("clones from existing variant", async () => {
    const r = await addVariant(ctx, {
      pageId: "onboarding",
      fromVariantId: "mobile",
      viewport: { w: 1440, h: 900 },
      name: "Desktop",
    });
    expect(r.variant.id).toBe("desktop");
    const onDisk = await readPage();
    expect(onDisk.variants).toHaveLength(2);
    expect(onDisk.variants[1]?.tree.children?.[0]?.$ref).toBe("Heading");
  });

  test("starts from a bare Card when no source", async () => {
    const r = await addVariant(ctx, {
      pageId: "onboarding",
      viewport: { w: 768, h: 1024 },
      name: "Tablet",
    });
    expect(r.variant.id).toBe("tablet");
    expect(r.variant.tree.$ref).toBe("Card");
    expect(r.variant.tree.children ?? []).toHaveLength(0);
  });
});

describe("applyClasses", () => {
  test("replaces className on a node", async () => {
    await applyClasses(ctx, {
      pageId: "onboarding",
      variantId: "mobile",
      path: [],
      classes: "p-12 max-w-xl mx-auto",
    });
    const onDisk = await readPage();
    expect(onDisk.variants[0]?.tree.props).toEqual({ className: "p-12 max-w-xl mx-auto" });
  });

  test("empty string clears className", async () => {
    await applyClasses(ctx, {
      pageId: "onboarding",
      variantId: "mobile",
      path: [],
      classes: "",
    });
    const onDisk = await readPage();
    expect(onDisk.variants[0]?.tree.props).toBeUndefined();
  });
});

describe("inspect", () => {
  test("returns ref + resolvedProps + classes + bodyHtml for a node", async () => {
    const r = await inspect(ctx, {
      pageId: "onboarding",
      variantId: "mobile",
      path: [0],
    });
    expect(r.ref).toBe("Heading");
    expect(r.resolvedProps).toEqual({ level: 1, children: "Welcome" });
    expect(r.bodyHtml).toContain("Welcome");
    expect(r.bodyHtml).toContain("<h1");
  });

  test("inspects the root", async () => {
    const r = await inspect(ctx, {
      pageId: "onboarding",
      variantId: "mobile",
      path: [],
    });
    expect(r.ref).toBe("Card");
    expect(r.classes).toEqual(["p-6"]);
  });
});
