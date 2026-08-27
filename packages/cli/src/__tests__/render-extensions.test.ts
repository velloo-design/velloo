import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Regression: the CLI render/publish path must compose the folder's
 * extensions into the registry (via `registryForScreen`), not read the
 * bare provider registry. A screen that references a declared extension
 * (`render:"live"` chart, custom component, …) used to crash these
 * commands with `UnknownComponentError`; now it renders the extension's
 * placeholder skeleton like every other render entry point.
 *
 * `render` and `publish` share the identical registry construction, so
 * exercising `render` (no cloud needed) guards both.
 */

const cliPath = resolve(import.meta.dir, "../cli.ts");

let tmp: string;

beforeEach(() => {
  tmp = join(tmpdir(), `velloo-render-ext-${Date.now()}-${Math.random().toString(36).slice(2)}`);
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function scaffold(design: string): Promise<void> {
  await mkdir(join(design, ".design"), { recursive: true });
  await mkdir(join(design, "theme"), { recursive: true });
  await mkdir(join(design, "screens"), { recursive: true });

  // No-lib provider: in-process, no network. Declares one live-island
  // extension the screen tree references.
  await writeFile(
    join(design, ".design", "config.json"),
    JSON.stringify({
      schemaVersion: 2,
      toolVersion: "0.0.1",
      libraries: {
        default: { id: "none", version: "0.1.0", source: "binary", componentsPath: "binary" },
      },
      defaultLibrary: "default",
      extensions: {
        Sparkline: {
          importPath: "@/components/charts",
          props: [],
          origin: "agent",
          render: "live",
          fit: "content",
        },
      },
      viewportPresets: [{ name: "Desktop", w: 1440, h: 900 }],
    }),
  );
  await writeFile(
    join(design, "theme", "default.json"),
    JSON.stringify({
      name: "default",
      colors: {
        background: "oklch(1 0 0)",
        foreground: "oklch(0.145 0 0)",
        primary: { DEFAULT: "oklch(0.55 0.18 280)", foreground: "oklch(0.985 0 0)" },
      },
      typography: {},
      spacing: {},
      radius: {},
    }),
  );
  await writeFile(
    join(design, "screens", "home.json"),
    JSON.stringify({
      id: "home",
      name: "Home",
      library: "default",
      tree: { $ref: "Box", children: [{ $ref: "Sparkline", props: {} }] },
    }),
  );
}

test("render resolves a screen's declared extension instead of crashing", async () => {
  const design = join(tmp, "velloo");
  await scaffold(design);
  const out = join(tmp, "home.html");

  const proc = Bun.spawn(["bun", cliPath, "render", "home", "--folder", design, "--to", out], {
    cwd: resolve(import.meta.dir, "../../../.."),
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  const stderr = await new Response(proc.stderr).text();
  if (exitCode !== 0) throw new Error(`velloo render failed (${exitCode}): ${stderr}`);

  const html = await readFile(out, "utf8");
  expect(html).toContain('data-velloo-extension="Sparkline"');
  expect(html).not.toContain("UnknownComponent");
});
