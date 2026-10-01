import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Screen } from "@velloo/schema";
import { designConfig, scaffoldDesignFolder } from "@velloo/server/testing";
import { PNG } from "pngjs";

/**
 * `velloo export` and `velloo render` capture the app's own components for
 * real, as the canvas does. Both build their pipeline in-process rather than
 * through the daemon's routes, and both used to set no client mount — so a
 * CLI-exported PNG showed dashed proxy frames where the canvas showed Mantine.
 * Spawns the real CLI, because the hole was in the command's wiring and
 * nothing below it. Needs the model-eval Mantine fixture with its dependencies
 * installed: `VELLOO_E2E=1 VELLOO_MANTINE_FIXTURE=<path> bun test`.
 */
const FIXTURE =
  process.env.VELLOO_MANTINE_FIXTURE ??
  join(homedir(), "play/velloo-modeleval/fixtures/mantine-sample");
const RUN =
  process.env.VELLOO_E2E === "1" &&
  existsSync(join(FIXTURE, "node_modules/@mantine/core/package.json"));

const CLI = join(dirname(import.meta.dir), "cli.ts");
/** The design's primary. Mantine's filled Button paints it; a proxy frame never does. */
const PRIMARY = { r: 0x0f, g: 0x76, b: 0x6e };

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

/** How many pixels of the design's primary the capture contains. */
async function primaryPixels(path: string): Promise<number> {
  const png = PNG.sync.read(await readFile(path));
  let hits = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const near = (actual: number | undefined, want: number) => Math.abs((actual ?? 0) - want) <= 6;
    if (
      near(png.data[i], PRIMARY.r) &&
      near(png.data[i + 1], PRIMARY.g) &&
      near(png.data[i + 2], PRIMARY.b)
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

describe.skipIf(!RUN)("CLI captures mount the app's own components", () => {
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
    expect(await primaryPixels(out)).toBeGreaterThan(1000);
  }, 180_000);

  test("velloo render agrees with it", async () => {
    const out = join(folder.root, "render.png");
    await run(["render", "ops", "--design", folder.root, "--to", out]);
    expect(await primaryPixels(out)).toBeGreaterThan(1000);
  }, 180_000);
});
