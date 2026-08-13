import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@velloo/schema";
import { type DesignFolder, loadDesignFolder } from "../../design-folder.ts";
import {
  addNode,
  applyClasses,
  applyClassesBulk,
  inspect,
  instantiateSnippet,
  type MutationContext,
  moveNode,
  removeNode,
  setNodeId,
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
          {
            $ref: "Heading",
            $id: "title",
            props: { level: 1, children: "A" },
          },
          { $ref: "Text", props: { children: "B" } },
          { $ref: "Button", $id: "cta", props: { children: "C" } },
        ],
      },
    },
    // Second variant — uses the same "cta" anchor for the same semantic node.
    {
      id: "desktop",
      name: "Desktop",
      viewport: { w: 1440, h: 900 },
      tree: {
        $ref: "Card",
        children: [
          { $ref: "Heading", $id: "title", props: { level: 1, children: "A" } },
          { $ref: "Button", $id: "cta", props: { children: "C" } },
        ],
      },
    },
  ],
};

let tmp: string;
let folder: DesignFolder;
let ctx: MutationContext;

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-ids-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(tmp, ".design"), { recursive: true });
  await mkdir(join(tmp, "theme"), { recursive: true });
  await mkdir(join(tmp, "pages"), { recursive: true });
  await writeFile(join(tmp, ".design/config.json"), JSON.stringify(sampleConfig), "utf8");
  await writeFile(join(tmp, "theme/default.json"), JSON.stringify(sampleTheme), "utf8");
  await writeFile(join(tmp, "pages/p.json"), JSON.stringify(samplePage), "utf8");
  folder = await loadDesignFolder(tmp);
  ctx = { folder, broadcast: () => {} };
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("@id locator resolution in mutations", () => {
  test("updateProps targets by @id and resolves to the right path", async () => {
    const r = await updateProps(ctx, {
      pageId: "p",
      variantId: "mobile",
      path: "@cta",
      propPatch: { children: "C!" },
    });
    if (!r.ok) throw new Error(`expected ok: ${JSON.stringify(r.error)}`);
    expect(r.value.path).toEqual([2]);
    const onDisk = JSON.parse(await readFile(join(tmp, "pages/p.json"), "utf8")) as Page;
    const root = onDisk.variants[0]?.tree;
    if (!root || !("$ref" in root)) throw new Error("expected root");
    const cta = root.children?.[2];
    if (!cta || !("$ref" in cta)) throw new Error("expected component");
    expect(cta.props?.children).toBe("C!");
  });

  test("applyClasses targets by @id", async () => {
    const r = await applyClasses(ctx, {
      pageId: "p",
      variantId: "mobile",
      path: "@title",
      classes: "text-3xl font-bold",
    });
    if (!r.ok) throw new Error("expected ok");
    expect(r.value.path).toEqual([0]);
  });

  test("@id survives a sibling insertion (the whole point)", async () => {
    // Insert a new Badge before the title — paths shift from [0,1,2] to [0,1,2,3].
    await addNode(ctx, {
      pageId: "p",
      variantId: "mobile",
      parentPath: [],
      componentRef: "Badge",
      index: 0,
      props: { children: "new" },
    });
    // @cta still resolves — even though its numeric path is now [3], not [2].
    const r = await updateProps(ctx, {
      pageId: "p",
      variantId: "mobile",
      path: "@cta",
      propPatch: { children: "C!" },
    });
    if (!r.ok) throw new Error(`expected ok: ${JSON.stringify(r.error)}`);
    expect(r.value.path).toEqual([3]);
  });

  test("IdNotFound when @id doesn't exist", async () => {
    const r = await updateProps(ctx, {
      pageId: "p",
      variantId: "mobile",
      path: "@missing",
      propPatch: { children: "x" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("IdNotFound");
      if (r.error.kind === "IdNotFound") {
        expect(r.error.id).toBe("missing");
        expect(r.error.variantId).toBe("mobile");
      }
    }
  });

  test("the same @id may resolve to different paths in different variants", async () => {
    const r1 = await updateProps(ctx, {
      pageId: "p",
      variantId: "mobile",
      path: "@cta",
      propPatch: { variant: "default" },
    });
    const r2 = await updateProps(ctx, {
      pageId: "p",
      variantId: "desktop",
      path: "@cta",
      propPatch: { variant: "default" },
    });
    if (!r1.ok || !r2.ok) throw new Error("expected both ok");
    expect(r1.value.path).toEqual([2]); // mobile: third child
    expect(r2.value.path).toEqual([1]); // desktop: second child (no Text in between)
  });
});

describe("add_node with id", () => {
  test("assigns the id and the new node is reachable via @id", async () => {
    const r = await addNode(ctx, {
      pageId: "p",
      variantId: "mobile",
      parentPath: [],
      componentRef: "Badge",
      id: "hero-badge",
      props: { children: "new" },
    });
    if (!r.ok) throw new Error("expected ok");
    // Use the id immediately afterward.
    const r2 = await updateProps(ctx, {
      pageId: "p",
      variantId: "mobile",
      path: "@hero-badge",
      propPatch: { children: "hello" },
    });
    if (!r2.ok) throw new Error(`expected ok: ${JSON.stringify(r2.error)}`);
  });

  test("id collision within the variant returns IdConflict", async () => {
    const r = await addNode(ctx, {
      pageId: "p",
      variantId: "mobile",
      parentPath: [],
      componentRef: "Badge",
      id: "cta", // already used by the Button in the seed page
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("IdConflict");
      if (r.error.kind === "IdConflict") {
        expect(r.error.id).toBe("cta");
        expect(r.error.paths.length).toBeGreaterThanOrEqual(2);
      }
    }
  });
});

describe("setNodeId", () => {
  test("assigns an id to an existing un-id'd node", async () => {
    // [1] is the Text without an id.
    const r = await setNodeId(ctx, {
      pageId: "p",
      variantId: "mobile",
      path: [1],
      id: "subtitle",
    });
    if (!r.ok) throw new Error(`expected ok: ${JSON.stringify(r.error)}`);
    expect(r.value.id).toBe("subtitle");
    // Reachable via @id immediately.
    const r2 = await updateProps(ctx, {
      pageId: "p",
      variantId: "mobile",
      path: "@subtitle",
      propPatch: { children: "B'" },
    });
    if (!r2.ok) throw new Error("expected ok");
  });

  test("clears an id with null", async () => {
    const r = await setNodeId(ctx, {
      pageId: "p",
      variantId: "mobile",
      path: "@title",
      id: null,
    });
    if (!r.ok) throw new Error("expected ok");
    // After clearing, @title no longer resolves.
    const r2 = await updateProps(ctx, {
      pageId: "p",
      variantId: "mobile",
      path: "@title",
      propPatch: { children: "x" },
    });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error.kind).toBe("IdNotFound");
  });

  test("rejects an id that conflicts with another node in the same variant", async () => {
    const r = await setNodeId(ctx, {
      pageId: "p",
      variantId: "mobile",
      path: [1], // Text node — try to give it the cta id
      id: "cta",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("IdConflict");
  });

  test("rejects badly-formatted ids at the route layer (zod) — but the mutation also defends", async () => {
    const r = await setNodeId(ctx, {
      pageId: "p",
      variantId: "mobile",
      path: [1],
      id: "1-leading-digit",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("BadRequest");
  });
});

describe("locator-aware bulk + structural ops", () => {
  test("applyClassesBulk accepts @id locators in each patch", async () => {
    const r = await applyClassesBulk(ctx, {
      pageId: "p",
      variantId: "mobile",
      patches: [
        { path: "@title", classes: "text-3xl font-bold" },
        { path: "@cta", classes: "bg-primary text-primary-foreground" },
      ],
    });
    if (!r.ok) throw new Error(`expected ok: ${JSON.stringify(r.error)}`);
    expect(r.value.paths).toEqual([[0], [2]]);
  });

  test("moveNode accepts @id locators for fromPath and toParent", async () => {
    // Wrap children in a new Card and move @cta inside it.
    await addNode(ctx, {
      pageId: "p",
      variantId: "mobile",
      parentPath: [],
      componentRef: "Card",
      id: "wrapper",
    });
    const r = await moveNode(ctx, {
      pageId: "p",
      variantId: "mobile",
      fromPath: "@cta",
      toParent: "@wrapper",
    });
    if (!r.ok) throw new Error(`expected ok: ${JSON.stringify(r.error)}`);
  });

  test("removeNode accepts @id", async () => {
    const r = await removeNode(ctx, {
      pageId: "p",
      variantId: "mobile",
      path: "@title",
    });
    if (!r.ok) throw new Error(`expected ok: ${JSON.stringify(r.error)}`);
    expect(r.value.removedRef).toBe("Heading");
  });

  test("inspect accepts @id", async () => {
    const r = await inspect(ctx, {
      pageId: "p",
      variantId: "mobile",
      path: "@cta",
    });
    if (!r.ok) throw new Error(`expected ok: ${JSON.stringify(r.error)}`);
    expect(r.value.ref).toBe("Button");
  });
});

describe("instantiate_snippet with id", () => {
  test("snippet instances support @id like component nodes", async () => {
    // Need a snippet on disk first; use a tiny inline one via add_snippet.
    // Instead, just create a snippets folder entry directly.
    await mkdir(join(tmp, "snippets"), { recursive: true });
    await writeFile(
      join(tmp, "snippets/divider.json"),
      JSON.stringify({
        id: "divider",
        name: "Divider",
        params: [],
        tree: { $ref: "Separator" },
      }),
      "utf8",
    );
    folder = await loadDesignFolder(tmp);
    ctx = { folder, broadcast: () => {} };

    const r = await instantiateSnippet(ctx, {
      pageId: "p",
      variantId: "mobile",
      parentPath: [],
      snippetId: "divider",
      id: "before-cta",
    });
    if (!r.ok) throw new Error(`expected ok: ${JSON.stringify(r.error)}`);
    // Now we can address the snippet instance by @id.
    const r2 = await removeNode(ctx, {
      pageId: "p",
      variantId: "mobile",
      path: "@before-cta",
    });
    if (!r2.ok) throw new Error("expected ok");
  });
});
