import { describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import { createApp } from "../app.ts";
import { type DesignFolder, loadDesignFolder } from "../design-folder.ts";
import { CanvasBundler } from "../live/canvas-bundler.ts";
import { LiveBundler, liveExtensions } from "../live/component-bundler.ts";
import type { MutationContext } from "../mutations/index.ts";
import { preflightScreens, screensForBoards, screensForExportTarget } from "../preflight.ts";
import { TailwindJit } from "../styles/tailwind-jit.ts";
import { designConfig, designTheme } from "../testing/design-folder.ts";

const provider = createShadcnProvider();

/**
 * A component that throws is replaced by a placeholder rather than failing the
 * render, which is what stops one bad node from taking a screen down. Export
 * and publish therefore succeed on a broken screen and ship the placeholder —
 * so both ask this first, before the browser starts or anything uploads.
 */

// `TabsTrigger` reads a context `Tabs` provides, so it renders inside one and
// throws outside it. That difference is the whole point of the check.
const brokenScreen = {
  id: "broken",
  name: "Broken",
  tree: {
    $ref: "Box",
    children: [
      { $ref: "Heading", props: { level: 1, children: "Settings" } },
      { $ref: "TabsTrigger", props: { value: "one", children: "One" } },
    ],
  },
};

const healthyScreen = {
  id: "healthy",
  name: "Healthy",
  tree: {
    $ref: "Box",
    children: [{ $ref: "Text", props: { children: "All good" } }],
  },
};

// The same component, correctly nested: this one must not be reported.
const nestedScreen = {
  id: "nested",
  name: "Nested",
  tree: {
    $ref: "Tabs",
    props: { defaultValue: "one" },
    children: [
      {
        $ref: "TabsList",
        children: [{ $ref: "TabsTrigger", props: { value: "one", children: "One" } }],
      },
    ],
  },
};

const board = {
  id: "main",
  name: "Main",
  frames: [
    { id: "f-broken", screen: "broken", x: 0, y: 0, w: 480, h: 360 },
    { id: "f-healthy", screen: "healthy", x: 560, y: 0, w: 480, h: 360 },
  ],
  groups: [],
};

const cleanBoard = {
  id: "clean",
  name: "Clean",
  frames: [{ id: "f-nested", screen: "nested", x: 0, y: 0, w: 480, h: 360 }],
  groups: [],
};

async function scaffold(): Promise<{ folder: DesignFolder; tmp: string }> {
  const tmp = join(
    tmpdir(),
    `velloo-preflight-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  for (const dir of [".design", "theme", "screens", "boards"]) {
    await mkdir(join(tmp, dir), { recursive: true });
  }
  const write = (path: string, value: unknown) =>
    writeFile(join(tmp, path), `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await write(".design/config.json", designConfig());
  await write("theme/default.json", designTheme());
  await write("screens/broken.json", brokenScreen);
  await write("screens/healthy.json", healthyScreen);
  await write("screens/nested.json", nestedScreen);
  await write("boards/main.json", board);
  await write("boards/clean.json", cleanBoard);
  return { folder: await loadDesignFolder(tmp), tmp };
}

function sourceFor(folder: DesignFolder) {
  return { folder, providers: { default: provider }, defaultProvider: provider };
}

describe("preflightScreens", () => {
  test("names the component, the screen, and why", async () => {
    const { folder, tmp } = await scaffold();
    try {
      const screen = folder.screens.get("broken");
      expect(screen).toBeDefined();
      const failures = preflightScreens(sourceFor(folder), screen ? [screen] : []);
      expect(failures).toHaveLength(1);
      expect(failures[0]?.screenId).toBe("broken");
      expect(failures[0]?.screenName).toBe("Broken");
      expect(failures[0]?.componentId).toBe("TabsTrigger");
      expect(failures[0]?.reason).toContain("Tabs");
      expect(failures[0]?.boards).toEqual([{ id: "main", name: "Main" }]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  // Nine parts without their parents: each is containable alone, together
  // they pass the guard's cap. Every one is still its own fix, so every one is
  // reported, followed by the screen-level failure.
  test("past the stand-in cap, lists each component and then the screen", async () => {
    const { folder, tmp } = await scaffold();
    try {
      const refs = [
        "TabsTrigger",
        "TabsList",
        "TabsContent",
        "AccordionItem",
        "AccordionContent",
        "AvatarImage",
        "AvatarFallback",
        "PopoverTrigger",
        "PopoverAnchor",
      ];
      const screen = {
        id: "too-many",
        name: "Too many",
        tree: { $ref: "Box", children: refs.map(($ref) => ({ $ref, props: { value: "a" } })) },
      };
      const failures = preflightScreens(sourceFor(folder), [screen]);
      expect(failures).toHaveLength(refs.length + 1);
      expect(failures.at(-1)?.componentId).toBeNull();
      expect(failures.at(-1)?.reason).toContain("more than the 8");
      expect(failures.at(-1)?.boards).toEqual([]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test("a healthy screen and a correctly-nested one both pass", async () => {
    const { folder, tmp } = await scaffold();
    try {
      const screens = [folder.screens.get("healthy"), folder.screens.get("nested")].filter(
        (s) => s !== undefined,
      );
      expect(screens).toHaveLength(2);
      expect(preflightScreens(sourceFor(folder), screens)).toEqual([]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("target resolution", () => {
  test("a board covers the screens its frames place", async () => {
    const { folder, tmp } = await scaffold();
    try {
      expect(screensForBoards(folder, ["main"]).map((s) => s.id)).toEqual(["broken", "healthy"]);
      expect(screensForExportTarget(folder, "frame", "f-healthy").map((s) => s.id)).toEqual([
        "healthy",
      ]);
      expect(screensForExportTarget(folder, "screen", "nested").map((s) => s.id)).toEqual([
        "nested",
      ]);
      expect(screensForExportTarget(folder, "board", "nope")).toEqual([]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("GET /api/preflight", () => {
  async function appFor(folder: DesignFolder) {
    const jit = new TailwindJit(provider, join(folder.root, "screens"));
    const bundler = new LiveBundler(
      folder.root,
      () => folder.config,
      () => liveExtensions(folder.config.extensions),
    );
    const canvasBundler = new CanvasBundler(
      folder.root,
      () => folder.config.hostApp,
      () => undefined,
    );
    const ctx: MutationContext = {
      folder,
      providers: { default: provider },
      defaultProvider: provider,
      broadcast: () => undefined,
    };
    return createApp(() => ctx, jit, bundler, canvasBundler);
  }

  test("reports an export target, and stays quiet on a clean one", async () => {
    const { folder, tmp } = await scaffold();
    try {
      const app = await appFor(folder);
      const get = (path: string) => app.fetch(new Request(`http://localhost${path}`));

      const broken = await get("/api/preflight?kind=board&id=main");
      expect(broken.status).toBe(200);
      const brokenBody = (await broken.json()) as { failures: { componentId: string }[] };
      expect(brokenBody.failures).toHaveLength(1);
      expect(brokenBody.failures[0]?.componentId).toBe("TabsTrigger");

      const clean = await get("/api/preflight?kind=board&id=clean");
      expect(((await clean.json()) as { failures: unknown[] }).failures).toEqual([]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test("a publish scope is boards, and no boards means every screen", async () => {
    const { folder, tmp } = await scaffold();
    try {
      const app = await appFor(folder);
      const get = (path: string) => app.fetch(new Request(`http://localhost${path}`));

      const scoped = await get("/api/preflight?boards=clean");
      expect(((await scoped.json()) as { failures: unknown[] }).failures).toEqual([]);

      // Unscoped covers the whole folder, so the broken screen surfaces.
      const all = await get("/api/preflight");
      expect(((await all.json()) as { failures: unknown[] }).failures).toHaveLength(1);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test("an unknown target is a 404, a bad kind a 400", async () => {
    const { folder, tmp } = await scaffold();
    try {
      const app = await appFor(folder);
      const get = (path: string) => app.fetch(new Request(`http://localhost${path}`));
      expect((await get("/api/preflight?kind=board&id=nope")).status).toBe(404);
      expect((await get("/api/preflight?kind=widget&id=main")).status).toBe(400);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
