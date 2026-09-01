import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromiumExecutable } from "@velloo/renderer";
import type { Server } from "bun";

type StubServer = Server<undefined>;

/**
 * Publish → screenshots wiring, end to end: the real command against a stub
 * cloud, real chromium rasterizing. Asserts the multipart carries the PNGs at
 * their bundle-relative paths and design.json indexes them.
 * The capture-time limit logic is unit-tested browser-less in
 * publish-screenshots.test.ts; this covers only the wiring, so one screen +
 * one board keeps it quick. Gated on an installed chromium, like the other
 * browser e2e suites.
 */

const hasChromium = (await chromiumExecutable()) !== null;

interface CapturedDesign {
  screenshots?: { cover: string; screens: Record<string, string>; boards: Record<string, string> };
}

const cliPath = resolve(import.meta.dir, "../cli.ts");

let tmp: string;
let server: StubServer;
let captured: { files: Map<string, Uint8Array>; design?: CapturedDesign };

beforeEach(() => {
  tmp = join(tmpdir(), `velloo-pub-shot-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  captured = { files: new Map() };
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const { pathname } = new URL(req.url);
      if (req.method === "POST" && pathname === "/v1/links") {
        return Response.json(
          { slug: "test-slug", visibility: "public", passwordProtected: false },
          { status: 201 },
        );
      }
      if (req.method === "POST" && pathname.endsWith("/versions")) {
        const form = await req.formData();
        for (const value of form.getAll("file")) {
          if (value instanceof File) {
            captured.files.set(value.name, new Uint8Array(await value.arrayBuffer()));
            if (value.name === "design.json") {
              captured.design = JSON.parse(
                new TextDecoder().decode(captured.files.get(value.name)),
              ) as CapturedDesign;
            }
          }
        }
        return Response.json(
          { files: captured.files.size, bytes: 1, url: "/s/test-slug/" },
          { status: 201 },
        );
      }
      return new Response("not found", { status: 404 });
    },
  });
});

afterEach(async () => {
  server.stop(true);
  await rm(tmp, { recursive: true, force: true });
});

async function scaffold(design: string): Promise<void> {
  await mkdir(join(design, ".design"), { recursive: true });
  await mkdir(join(design, "theme"), { recursive: true });
  await mkdir(join(design, "screens"), { recursive: true });
  await mkdir(join(design, "boards"), { recursive: true });
  await writeFile(
    join(design, ".design", "config.json"),
    JSON.stringify({
      schemaVersion: 2,
      toolVersion: "0.0.1",
      libraries: {
        default: { id: "none", version: "0.1.0", source: "binary", componentsPath: "binary" },
      },
      defaultLibrary: "default",
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
      tree: { $ref: "Box", children: [] },
    }),
  );
  await writeFile(
    join(design, "boards", "main.json"),
    JSON.stringify({
      id: "main",
      name: "Main",
      frames: [{ id: "f1", screen: "home", x: 0, y: 0, w: 600, h: 400 }],
      groups: [],
    }),
  );
}

async function runPublish(design: string, extraArgs: string[] = []) {
  const proc = Bun.spawn(
    [
      "bun",
      cliPath,
      "publish",
      design,
      "--url",
      `http://localhost:${server.port}`,
      "--token",
      "test-token",
      "--slug",
      "test-slug",
      ...extraArgs,
    ],
    { cwd: resolve(import.meta.dir, "../../../.."), stdout: "pipe", stderr: "pipe" },
  );
  const exitCode = await proc.exited;
  const stderr = await new Response(proc.stderr).text();
  return { exitCode, stderr };
}

// PNG magic bytes — the uploads are real rasters, not placeholders.
function isPng(bytes: Uint8Array | undefined): boolean {
  return (
    !!bytes && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  );
}

test.skipIf(!hasChromium)(
  "publish captures screen + board + cover PNGs and indexes them in design.json",
  async () => {
    const design = join(tmp, "velloo");
    await scaffold(design);
    const { exitCode, stderr } = await runPublish(design);
    if (exitCode !== 0) throw new Error(`publish failed (${exitCode}): ${stderr}`);

    expect(captured.design?.screenshots).toEqual({
      cover: "screenshots/cover.png",
      screens: { home: "screenshots/home.png" },
      boards: { main: "screenshots/main.png" },
    });
    expect(isPng(captured.files.get("screenshots/home.png"))).toBe(true);
    expect(isPng(captured.files.get("screenshots/main.png"))).toBe(true);
    expect(isPng(captured.files.get("screenshots/cover.png"))).toBe(true);
  },
  120_000,
);

test("--no-screenshots publishes without any screenshot files or manifest", async () => {
  const design = join(tmp, "velloo");
  await scaffold(design);
  const { exitCode, stderr } = await runPublish(design, ["--no-screenshots"]);
  if (exitCode !== 0) throw new Error(`publish failed (${exitCode}): ${stderr}`);

  expect(captured.design?.screenshots).toBeUndefined();
  expect([...captured.files.keys()].some((n) => n.startsWith("screenshots/"))).toBe(false);
});
