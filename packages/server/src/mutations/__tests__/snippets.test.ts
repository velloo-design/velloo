import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Result } from "@velloo/result";
import type { Page, Snippet } from "@velloo/schema";
import { type DesignFolder, loadDesignFolder } from "../../design-folder.ts";
import type { WatchEvent } from "../../watcher.ts";
import {
  addSnippet,
  instantiateSnippet,
  type MutationContext,
  type MutationError,
  removeSnippet,
  updateSnippet,
  updateSnippetArgs,
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
  name: "Marketing",
  variants: [
    {
      id: "mobile",
      name: "Mobile",
      viewport: { w: 390, h: 844 },
      tree: { $ref: "Card", props: { className: "p-6" } },
    },
  ],
};

const featureCard: Snippet = {
  id: "feature-card",
  name: "Feature Card",
  params: [
    { name: "title", type: "string" },
    { name: "body", type: "string", default: "" },
  ],
  tree: {
    $ref: "Card",
    children: [
      { $ref: "Heading", props: { level: 3, children: { $param: "title" } } },
      { $ref: "Text", props: { children: { $param: "body" } } },
    ],
  },
};

let tmp: string;
let folder: DesignFolder;
let ctx: MutationContext;
let broadcasts: WatchEvent[];

function expectOk<T>(r: Result<T, MutationError>): T {
  if (!r.ok) throw new Error(`expected ok, got: ${JSON.stringify(r.error)}`);
  return r.value;
}
function expectErr<K extends MutationError["kind"]>(
  r: Result<unknown, MutationError>,
  kind: K,
): Extract<MutationError, { kind: K }> {
  if (r.ok) throw new Error(`expected err of kind ${kind}, got ok`);
  if (r.error.kind !== kind) {
    throw new Error(`expected err.kind=${kind}, got ${r.error.kind}: ${JSON.stringify(r.error)}`);
  }
  return r.error as Extract<MutationError, { kind: K }>;
}

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-snip-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(tmp, ".design"), { recursive: true });
  await mkdir(join(tmp, "theme"), { recursive: true });
  await mkdir(join(tmp, "pages"), { recursive: true });
  await writeFile(join(tmp, ".design/config.json"), JSON.stringify(sampleConfig), "utf8");
  await writeFile(join(tmp, "theme/default.json"), JSON.stringify(sampleTheme), "utf8");
  await writeFile(join(tmp, "pages/marketing.json"), JSON.stringify(samplePage), "utf8");
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

describe("addSnippet", () => {
  test("creates a snippet, persists it, broadcasts snippet-changed", async () => {
    const r = expectOk(await addSnippet(ctx, featureCard));
    expect(r.snippetId).toBe("feature-card");
    expect(folder.snippets.get("feature-card")?.params).toHaveLength(2);
    const onDisk = await readFile(join(tmp, "snippets/feature-card.json"), "utf8");
    expect(JSON.parse(onDisk)).toMatchObject({ id: "feature-card" });
    expect(broadcasts.at(-1)).toEqual({ type: "snippet-changed", snippetId: "feature-card" });
  });

  test("rejects id conflict", async () => {
    expectOk(await addSnippet(ctx, featureCard));
    expectErr(await addSnippet(ctx, featureCard), "SnippetIdConflict");
  });

  test("rejects body that contains a self-reference (cycle)", async () => {
    const recursive: Snippet = {
      ...featureCard,
      tree: {
        $ref: "Card",
        children: [{ $snippet: "feature-card" }],
      },
    };
    const err = expectErr(await addSnippet(ctx, recursive), "SnippetCycle");
    expect(err.viaPath).toContain("feature-card");
  });
});

describe("instantiateSnippet", () => {
  test("inserts a $snippet node, validates args, returns path", async () => {
    expectOk(await addSnippet(ctx, featureCard));
    const r = expectOk(
      await instantiateSnippet(ctx, {
        pageId: "marketing",
        variantId: "mobile",
        parentPath: [],
        snippetId: "feature-card",
        args: { title: "Fast", body: "Snappy." },
      }),
    );
    expect(r.path).toEqual([0]);
    const onDisk = JSON.parse(await readFile(join(tmp, "pages/marketing.json"), "utf8")) as Page;
    const first = onDisk.variants[0]?.tree;
    if (!first || !("$ref" in first)) throw new Error("expected component root");
    const child = first.children?.[0];
    expect(child).toMatchObject({ $snippet: "feature-card", args: { title: "Fast" } });
  });

  test("missing required arg → SnippetParamMismatch", async () => {
    expectOk(await addSnippet(ctx, featureCard));
    const err = expectErr(
      await instantiateSnippet(ctx, {
        pageId: "marketing",
        variantId: "mobile",
        parentPath: [],
        snippetId: "feature-card",
        args: {},
      }),
      "SnippetParamMismatch",
    );
    expect(err.reason).toMatch(/title/);
  });

  test("unknown arg key → SnippetParamMismatch", async () => {
    expectOk(await addSnippet(ctx, featureCard));
    expectErr(
      await instantiateSnippet(ctx, {
        pageId: "marketing",
        variantId: "mobile",
        parentPath: [],
        snippetId: "feature-card",
        args: { title: "x", body: "y", color: "red" },
      }),
      "SnippetParamMismatch",
    );
  });

  test("default values let optional params be omitted", async () => {
    expectOk(await addSnippet(ctx, featureCard));
    expectOk(
      await instantiateSnippet(ctx, {
        pageId: "marketing",
        variantId: "mobile",
        parentPath: [],
        snippetId: "feature-card",
        args: { title: "Just title" }, // body has a default ""
      }),
    );
  });
});

describe("updateSnippetArgs", () => {
  test("patches an instance's args without touching the snippet body", async () => {
    expectOk(await addSnippet(ctx, featureCard));
    expectOk(
      await instantiateSnippet(ctx, {
        pageId: "marketing",
        variantId: "mobile",
        parentPath: [],
        snippetId: "feature-card",
        args: { title: "old", body: "old body" },
      }),
    );
    expectOk(
      await updateSnippetArgs(ctx, {
        pageId: "marketing",
        variantId: "mobile",
        path: [0],
        argPatch: { title: "new" },
      }),
    );
    const onDisk = JSON.parse(await readFile(join(tmp, "pages/marketing.json"), "utf8")) as Page;
    const root = onDisk.variants[0]?.tree;
    if (!root || !("$ref" in root)) throw new Error("expected root");
    expect(root.children?.[0]).toMatchObject({ args: { title: "new", body: "old body" } });
  });

  test("refuses to patch a non-$snippet node", async () => {
    expectErr(
      await updateSnippetArgs(ctx, {
        pageId: "marketing",
        variantId: "mobile",
        path: [], // the root Card is a component, not a snippet
        argPatch: { x: 1 },
      }),
      "InvalidPath",
    );
  });
});

describe("removeSnippet", () => {
  test("refuses if a page still instantiates it; returns referencing pageIds", async () => {
    expectOk(await addSnippet(ctx, featureCard));
    expectOk(
      await instantiateSnippet(ctx, {
        pageId: "marketing",
        variantId: "mobile",
        parentPath: [],
        snippetId: "feature-card",
        args: { title: "x" },
      }),
    );
    const err = expectErr(await removeSnippet(ctx, { snippetId: "feature-card" }), "SnippetInUse");
    expect(err.pageIds).toEqual(["marketing"]);
  });

  test("removes the snippet when no page references it", async () => {
    expectOk(await addSnippet(ctx, featureCard));
    expectOk(await removeSnippet(ctx, { snippetId: "feature-card" }));
    expect(folder.snippets.has("feature-card")).toBe(false);
  });
});

describe("updateSnippet", () => {
  test("renames + replaces body; instances pick up the new body through render", async () => {
    expectOk(await addSnippet(ctx, featureCard));
    expectOk(
      await updateSnippet(ctx, {
        snippetId: "feature-card",
        patch: { name: "Card v2" },
      }),
    );
    expect(folder.snippets.get("feature-card")?.name).toBe("Card v2");
  });

  test("rejects an updated body that introduces a cycle", async () => {
    expectOk(await addSnippet(ctx, featureCard));
    const r = await updateSnippet(ctx, {
      snippetId: "feature-card",
      patch: {
        tree: {
          $ref: "Card",
          children: [{ $snippet: "feature-card" }],
        },
      },
    });
    expectErr(r, "SnippetCycle");
  });
});
