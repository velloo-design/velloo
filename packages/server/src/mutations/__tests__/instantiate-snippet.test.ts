import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Node, SnippetInstance, Theme } from "@velloo/schema";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import type { ActivityEvent } from "../../activity.ts";
import { type DesignFolder, loadDesignFolder } from "../../design-folder.ts";
import { pathAt } from "../../path.ts";
import type { WatchEvent } from "../../watcher.ts";
import { addSnippet, instantiateSnippet, type MutationContext } from "../index.ts";

const provider = createShadcnProvider();

const sampleConfig = {
  schemaVersion: 2,
  toolVersion: "0.1.0",
  libraries: {
    default: {
      id: "shadcn-upstream",
      version: "test",
      source: "binary",
      componentsPath: "binary",
    },
  },
  defaultLibrary: "default",
  viewportPresets: [{ name: "Desktop", w: 1440, h: 900 }],
};

const sampleTheme: Theme = {
  name: "default",
  colors: {
    background: "#fff",
    foreground: "#000",
    primary: { DEFAULT: "#000", foreground: "#fff" },
  },
  typography: {},
  spacing: {},
  radius: {},
};

let tmp: string;
let folder: DesignFolder;
let ctx: MutationContext;
let events: (WatchEvent | ActivityEvent)[];

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-inst-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(tmp, ".design"), { recursive: true });
  await mkdir(join(tmp, "theme"), { recursive: true });
  await mkdir(join(tmp, "screens"), { recursive: true });
  await mkdir(join(tmp, "snippets"), { recursive: true });
  await writeJson(join(tmp, ".design/config.json"), sampleConfig);
  await writeJson(join(tmp, "theme/default.json"), sampleTheme);
  await writeJson(join(tmp, "screens/landing.json"), {
    id: "landing",
    name: "Landing",
    tree: { $ref: "Card", props: { className: "p-4" }, children: [] },
  });
  folder = await loadDesignFolder(tmp);
  events = [];
  ctx = {
    folder,
    providers: { default: provider },
    defaultProvider: provider,
    broadcast: (e) => events.push(e),
  };
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("instantiateSnippet", () => {
  test("honors `optional` params — omitting them matches the add_node path (no error)", async () => {
    const added = await addSnippet(ctx, {
      name: "Quote",
      params: [
        { name: "body", type: "string" },
        { name: "quoteIcon", type: "node", optional: true },
      ],
      tree: {
        $ref: "Box",
        children: [
          { $param: "quoteIcon" },
          { $ref: "Text", props: { children: { $param: "body" } } },
        ],
      },
    });
    expect(added.ok).toBe(true);
    const snippetId = added.ok ? added.value.snippetId : "quote";

    const r = await instantiateSnippet(ctx, {
      screenId: "landing",
      parentPath: [],
      snippetId,
      args: { body: "Just the required one" }, // quoteIcon omitted
    });
    expect(r.ok).toBe(true);
  });

  test("still errors when a required param is missing", async () => {
    const added = await addSnippet(ctx, {
      name: "Req",
      params: [{ name: "body", type: "string" }],
      tree: { $ref: "Text", props: { children: { $param: "body" } } },
    });
    const snippetId = added.ok ? added.value.snippetId : "req";

    const r = await instantiateSnippet(ctx, {
      screenId: "landing",
      parentPath: [],
      snippetId,
      args: {},
    });
    expect(r.ok).toBe(false);
  });

  test("applies inline `overrides` to the placed instance, keyed by a body $id", async () => {
    const added = await addSnippet(ctx, {
      name: "Rail",
      params: [],
      tree: {
        $ref: "Box",
        children: [
          { $ref: "Button", $id: "home", props: { children: "Home" } },
          { $ref: "Button", $id: "settings", props: { children: "Settings" } },
        ],
      },
    });
    const snippetId = added.ok ? added.value.snippetId : "rail";

    const r = await instantiateSnippet(ctx, {
      screenId: "landing",
      parentPath: [],
      snippetId,
      overrides: { "@home": { props: { className: "bg-accent" } } },
    });
    expect(r.ok).toBe(true);
    const path = r.ok ? r.value.path : [];
    const tree = folder.screens.get("landing")?.tree as Node | undefined;
    const placed = tree ? (pathAt(tree, path) as SnippetInstance | undefined) : undefined;
    expect(placed?.$overrides).toEqual({ "@home": { props: { className: "bg-accent" } } });
  });

  test("rejects an `overrides` key that doesn't resolve to a body node", async () => {
    const added = await addSnippet(ctx, {
      name: "Rail2",
      params: [],
      tree: { $ref: "Box", children: [{ $ref: "Button", $id: "home" }] },
    });
    const snippetId = added.ok ? added.value.snippetId : "rail2";

    const r = await instantiateSnippet(ctx, {
      screenId: "landing",
      parentPath: [],
      snippetId,
      overrides: { "@nope": { props: { className: "x" } } },
    });
    expect(r.ok).toBe(false);
  });
});
