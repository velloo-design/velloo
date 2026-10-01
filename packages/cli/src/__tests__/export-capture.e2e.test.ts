import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Screen } from "@velloo/schema";
import { designConfig, scaffoldDesignFolder } from "@velloo/server/testing";
import { PNG } from "pngjs";

/**
 * `velloo export` and `velloo render` capture what the canvas shows. Both build
 * their pipeline in-process rather than through the daemon's routes, and both
 * used to set neither the client mount nor the live-island bundle — so a
 * CLI-exported PNG showed dashed proxy frames where the canvas showed Mantine,
 * and a placeholder skeleton where it ran the app's real chart. Spawns the real
 * CLI, because the hole was in the commands' wiring and nothing below it.
 *
 * The live-island case runs anywhere (its host fixture resolves React from the
 * workspace). The repository-component case needs the model-eval Mantine
 * fixture with its dependencies installed:
 * `VELLOO_E2E=1 VELLOO_MANTINE_FIXTURE=<path> bun test`.
 */
const FIXTURE =
  process.env.VELLOO_MANTINE_FIXTURE ??
  join(homedir(), "play/velloo-modeleval/fixtures/mantine-sample");
/** Opt-in: needs a browser (`velloo browser install`). */
const RUN = process.env.VELLOO_E2E === "1";
/** The repository-component case additionally needs the model-eval fixture. */
const RUN_REPO = RUN && existsSync(join(FIXTURE, "node_modules/@mantine/core/package.json"));

const CLI = join(dirname(import.meta.dir), "cli.ts");
const LIVE_HOST = join(import.meta.dir, "fixtures", "live-host");
/** The design's primary. Mantine's filled Button paints it; a proxy frame never does. */
const PRIMARY = { r: 0x0f, g: 0x76, b: 0x6e };
/** The live-island fixture's colour. Only the real component, client-mounted, paints it. */
const ISLAND = { r: 0xff, g: 0x00, b: 0xaa };

const screen: Screen = {
  id: "ops",
  name: "Ops",
  tree: {
    $ref: "Stack",
    $repo: { importPath: "@mantine/core", exportName: "Stack" },
    props: { p: "lg", gap: "md" },
    children: [
      {
        $ref: "Button",
        $repo: { importPath: "@mantine/core", exportName: "Button" },
        props: { children: "Deploy" },
      },
    ],
  },
};

/** How many pixels of one colour the capture contains. */
async function pixelsOf(path: string, want: { r: number; g: number; b: number }): Promise<number> {
  const png = PNG.sync.read(await readFile(path));
  let hits = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const near = (actual: number | undefined, target: number) =>
      Math.abs((actual ?? 0) - target) <= 6;
    if (
      near(png.data[i], want.r) &&
      near(png.data[i + 1], want.g) &&
      near(png.data[i + 2], want.b)
    ) {
      hits++;
    }
  }
  return hits;
}

async function run(args: string[]): Promise<void> {
  const proc = Bun.spawn(["bun", CLI, ...args], { stdout: "pipe", stderr: "pipe" });
  const [code, err] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  if (code !== 0) throw new Error(`velloo ${args[0]} exited ${code}: ${err}`);
}

describe.skipIf(!RUN_REPO)("CLI captures mount the app's own components", () => {
  let folder: Awaited<ReturnType<typeof scaffoldDesignFolder>>;

  beforeAll(async () => {
    folder = await scaffoldDesignFolder({
      label: "cli-export-mantine",
      config: designConfig({
        library: { id: "none", version: "t", source: "binary", componentsPath: "binary" },
        styling: { framework: "none" },
        hostApp: { root: FIXTURE },
      }),
      theme: {
        colors: {
          background: "#ffffff",
          foreground: "#111827",
          primary: { DEFAULT: "#0f766e", foreground: "#ffffff" },
        },
      },
      screens: { ops: screen },
    });
  }, 60_000);

  afterAll(async () => {
    await folder?.cleanup();
  });

  test("velloo export paints real Mantine, not a proxy frame", async () => {
    const out = join(folder.root, "ops.png");
    await run(["export", "ops", "--design", folder.root, "--to", out]);
    // A filled Mantine Button in the design's primary — the recipe's theme
    // mapping reaching a one-shot CLI capture. The proxy render is a dashed
    // grey frame with a label, and contains none of it.
    expect(await pixelsOf(out, PRIMARY)).toBeGreaterThan(1000);
  }, 180_000);

  test("velloo render agrees with it", async () => {
    const out = join(folder.root, "render.png");
    await run(["render", "ops", "--design", folder.root, "--to", out]);
    expect(await pixelsOf(out, PRIMARY)).toBeGreaterThan(1000);
  }, 180_000);
});

describe.skipIf(!RUN)("CLI captures run live islands", () => {
  let folder: Awaited<ReturnType<typeof scaffoldDesignFolder>>;

  beforeAll(async () => {
    folder = await scaffoldDesignFolder({
      label: "cli-export-live",
      config: designConfig({
        library: { id: "none", version: "t", source: "binary", componentsPath: "binary" },
        styling: { framework: "none" },
        hostApp: { root: LIVE_HOST },
        extensions: {
          Sparkline: {
            importPath: "./src/charts.jsx",
            props: [],
            origin: "manual",
            render: "live",
            fit: "content",
          },
        },
      }),
      screens: {
        home: {
          id: "home",
          name: "Home",
          tree: { $ref: "Box", children: [{ $ref: "Sparkline", props: {} }] },
        } as Screen,
      },
    });
  }, 60_000);

  afterAll(async () => {
    await folder?.cleanup();
  });

  test("velloo export mounts the island, not its placeholder", async () => {
    const out = join(folder.root, "home.png");
    await run(["export", "home", "--design", folder.root, "--to", out]);
    // The placeholder skeleton is text on white and paints none of this.
    expect(await pixelsOf(out, ISLAND)).toBeGreaterThan(10_000);
  }, 180_000);

  test("velloo render agrees with it", async () => {
    const out = join(folder.root, "render.png");
    await run(["render", "home", "--design", folder.root, "--to", out]);
    expect(await pixelsOf(out, ISLAND)).toBeGreaterThan(10_000);
  }, 180_000);
});
