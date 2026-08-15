import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitCode } from "@velloo/codegen";
import { unwrap } from "@velloo/result";
import type { Theme } from "@velloo/schema";
import { isComponentNode } from "@velloo/schema";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import { type DesignFolder, loadDesignFolder } from "../../design-folder.ts";
import type { WatchEvent } from "../../watcher.ts";
import { addNode, applyClasses, type MutationContext } from "../index.ts";

/**
 * End-to-end happy path for the mutation surface: scaffold a folder on
 * disk → load it → add a node → apply some classes → emit the agent IR
 * → confirm the emitted JSX reflects the mutation. This guards the
 * substrate that every other mutation builds on.
 */

const sampleConfig = {
  schemaVersion: 1,
  toolVersion: "0.1.0",
  library: {
    id: "shadcn-react" as const,
    version: "test",
    source: "binary",
    componentsPath: "binary",
  },
  viewportPresets: [{ name: "Desktop", w: 1440, h: 900 }],
};

const provider = createShadcnProvider();

const sampleTheme: Theme = {
  name: "default",
  colors: {
    background: "oklch(1 0 0)",
    foreground: "oklch(0.145 0 0)",
    primary: { DEFAULT: "oklch(0.55 0.18 280)", foreground: "oklch(0.985 0 0)" },
  },
  typography: {},
  spacing: {},
  radius: {},
};

const sampleScreen = {
  id: "landing",
  name: "Landing",
  tree: {
    $ref: "Card",
    props: { className: "p-4" },
    children: [],
  },
};

let tmp: string;
let folder: DesignFolder;
let ctx: MutationContext;
let events: WatchEvent[];

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-mut-smoke-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(tmp, ".design"), { recursive: true });
  await mkdir(join(tmp, "theme"), { recursive: true });
  await mkdir(join(tmp, "screens"), { recursive: true });
  await writeJson(join(tmp, ".design/config.json"), sampleConfig);
  await writeJson(join(tmp, "theme/default.json"), sampleTheme);
  await writeJson(join(tmp, "screens/landing.json"), sampleScreen);
  folder = await loadDesignFolder(tmp);
  events = [];
  ctx = {
    folder,
    providers: { default: provider },
    defaultProvider: provider,
    provider,
    broadcast: (e) => events.push(e),
  };
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("mutation happy path", () => {
  test("add_node → apply_classes → emit_code reflects the new node", async () => {
    // 1. Add a Heading under the Card root.
    const addResult = unwrap(
      await addNode(ctx, {
        screenId: "landing",
        parentPath: [],
        componentRef: "Heading",
        props: { level: 1, children: "Welcome" },
      }),
    );
    expect(addResult.path).toEqual([0]);

    // 2. Apply a className to the new heading.
    unwrap(
      await applyClasses(ctx, {
        screenId: "landing",
        path: addResult.path,
        classes: "text-4xl font-bold",
      }),
    );

    // 3. Read back the screen and emit the agent IR.
    const screen = folder.screens.get("landing");
    expect(screen).toBeDefined();
    if (!screen) return;
    expect(isComponentNode(screen.tree)).toBe(true);
    if (isComponentNode(screen.tree)) {
      expect(screen.tree.$ref).toBe("Card");
    }

    const ir = unwrap(await emitCode(screen));
    expect(ir.componentsUsed).toContain("Heading");
    expect(ir.componentsUsed).toContain("Card");
    expect(ir.classesUsed).toContain("text-4xl");
    expect(ir.classesUsed).toContain("font-bold");
    expect(ir.jsx).toContain("Welcome");
    expect(ir.jsx).toContain("<Card");
    // Heading level=1 renders as <h1> in the agent IR.
    expect(ir.jsx).toMatch(/<h1\b/);

    // 4. Confirm watcher events fired for the two mutations.
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.every((e) => e.type === "screen-changed")).toBe(true);
  });

  test("add_node rejects an unknown component ref", async () => {
    const r = await addNode(ctx, {
      screenId: "landing",
      parentPath: [],
      componentRef: "Definitely-Not-Real",
    });
    expect(r.ok).toBe(false);
  });

  test("add_node rejects an out-of-range parent path", async () => {
    const r = await addNode(ctx, {
      screenId: "landing",
      parentPath: [99],
      componentRef: "Heading",
    });
    expect(r.ok).toBe(false);
  });

  test("update_props against snippet:<id> routes to snippet body + broadcasts snippet-changed", async () => {
    // Seed a snippet on disk so `loadDesignFolder` picks it up.
    await mkdir(join(tmp, "snippets"), { recursive: true });
    await writeJson(join(tmp, "snippets/feature-row.json"), {
      id: "feature-row",
      name: "Feature Row",
      params: [],
      tree: { $ref: "Card", props: { className: "p-4" }, children: [] },
    });
    folder = await loadDesignFolder(tmp);
    events = [];
    ctx = {
      folder,
      providers: { default: provider },
      defaultProvider: provider,
      provider,
      broadcast: (e) => events.push(e),
    };

    // The snippet body's root is the Card we just wrote — patch its
    // className via the virtualized screen id. The mutation layer
    // recognizes the `snippet:` prefix, persists the snippet (not a
    // screen), and broadcasts `snippet-changed`.
    const { applyClasses: ac } = await import("../index.ts");
    const result = await ac(ctx, {
      screenId: "snippet:feature-row",
      path: [],
      classes: "p-8 rounded-lg",
    });
    expect(result.ok).toBe(true);

    const updated = folder.snippets.get("feature-row");
    expect(updated).toBeDefined();
    if (updated && isComponentNode(updated.tree)) {
      expect(updated.tree.props?.className).toBe("p-8 rounded-lg");
    }
    expect(events.some((e) => e.type === "snippet-changed")).toBe(true);
    expect(events.some((e) => e.type === "screen-changed")).toBe(false);
  });
});
