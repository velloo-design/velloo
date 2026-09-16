import { afterEach, beforeEach } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import { createApp } from "../app.ts";
import { type DesignFolder, loadDesignFolder } from "../design-folder.ts";
import { CanvasBundler } from "../live/canvas-bundler.ts";
import { LiveBundler, liveExtensions } from "../live/component-bundler.ts";
import type { MutationContext } from "../mutations/index.ts";
import { TailwindJit } from "../styles/tailwind-jit.ts";
import { designConfig, designTheme } from "../testing/design-folder.ts";

const provider = createShadcnProvider();

/**
 * The design folder and app both /api/export suites run against: two screens
 * on one board, at deliberately different frame viewports, plus an asset.
 */

const sampleConfig = designConfig();

const sampleTheme = designTheme();

// A tiny valid PNG (1×1, transparent) for asset inlining.
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const homeScreen = {
  id: "home",
  name: "Home",
  tree: {
    $ref: "Box",
    props: { className: "p-8 flex flex-col gap-4" },
    children: [
      { $ref: "Heading", props: { level: 1, children: "Welcome home" } },
      { $ref: "Image", props: { src: "/assets/logo.png", alt: "logo" } },
    ],
  },
};

const aboutScreen = {
  id: "about",
  name: "About",
  tree: {
    $ref: "Box",
    props: { className: "p-8" },
    children: [{ $ref: "Text", props: { children: "About us" } }],
  },
};

// The two frames deliberately have DIFFERENT viewports so the board-PDF test
// can prove each deck page keeps its own frame's size (Chromium named pages).
const mainBoard = {
  id: "main",
  name: "Main flow",
  frames: [
    { id: "f-home", screen: "home", x: 0, y: 0, w: 480, h: 360, label: "Home / desktop" },
    { id: "f-about", screen: "about", x: 560, y: 0, w: 800, h: 600 },
  ],
  groups: [],
};

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/**
 * Scaffold the fixture folder before each test and clean it up after; returns
 * a request helper against the app and the current folder's path.
 */
export function exportRoutesApp(): {
  get: (path: string) => Promise<Response>;
  root: () => string;
} {
  let tmp: string;
  let folder: DesignFolder;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    tmp = join(
      tmpdir(),
      `velloo-export-routes-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    for (const dir of [".design", "theme", "screens", "boards", "assets"]) {
      await mkdir(join(tmp, dir), { recursive: true });
    }
    await writeJson(join(tmp, ".design/config.json"), sampleConfig);
    await writeJson(join(tmp, "theme/default.json"), sampleTheme);
    await writeJson(join(tmp, "screens/home.json"), homeScreen);
    await writeJson(join(tmp, "screens/about.json"), aboutScreen);
    await writeJson(join(tmp, "boards/main.json"), mainBoard);
    await writeFile(join(tmp, "assets/logo.png"), PNG_BYTES);
    folder = await loadDesignFolder(tmp);
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
    app = createApp(() => ctx, jit, bundler, canvasBundler);
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  return {
    get: (path) => Promise.resolve(app.fetch(new Request(`http://localhost${path}`))),
    root: () => tmp,
  };
}
