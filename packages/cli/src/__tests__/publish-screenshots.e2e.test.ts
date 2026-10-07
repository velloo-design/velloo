import { afterEach, beforeEach, expect, setDefaultTimeout, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromiumExecutable } from "@velloo/renderer";
import type { Server } from "bun";

// Scaffolds a real git repo and drives a headless browser. Under
// `bun test --parallel` both queue behind every other worker, and the 5s
// default starts tripping.
setDefaultTimeout(60_000);

/**
 * The fixture repo answers to this file alone: the machine's git config stays
 * out of it (hooks, filters, a credential prompt nobody answers), and so does
 * git's own auto-maintenance — the baseline commit would otherwise leave a
 * detached `git maintenance` working in `.git` while publish reads the repo
 * and `afterEach` removes it. Set on the process so the spawned `velloo
 * publish` inherits it.
 */
process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_SYSTEM = "/dev/null";
process.env.GIT_TERMINAL_PROMPT = "0";
process.env.GIT_CONFIG_COUNT = "1";
process.env.GIT_CONFIG_KEY_0 = "maintenance.auto";
process.env.GIT_CONFIG_VALUE_0 = "false";

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
      schemaVersion: 4,
      name: "test",
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
      "--new",
      "--slug",
      "test-slug",
      "--public",
      ...extraArgs,
    ],
    { cwd: resolve(import.meta.dir, "../../../.."), stdout: "pipe", stderr: "pipe" },
  );
  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { exitCode, stdout, stderr };
}

/**
 * Awaited, not `execFileSync`. Under `bun test` a synchronous spawn waits in an
 * event loop of its own, whose only other wake-up is the test's deadline. On CI
 * a `git` that had already exited 0 held this test there for its full 60s, and
 * the failure surfaced as the *next* command running in a repo `afterEach` had
 * begun deleting. Why Bun sat on that exit is not known — millions of stressed
 * spawns on Linux have not reproduced it — but the main loop at least has other
 * events to wake it.
 */
async function git(cwd: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(
    ["git", "-C", cwd, "-c", "user.email=test@example.com", "-c", "user.name=Test", ...args],
    { stdin: "ignore", stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed (${exitCode}): ${stderr}`);
  return stdout.trim();
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
    const { exitCode, stdout, stderr } = await runPublish(design);
    if (exitCode !== 0) throw new Error(`publish failed (${exitCode}): ${stderr}`);

    expect(captured.design?.screenshots).toEqual({
      cover: "screenshots/cover.png",
      screens: { home: "screenshots/home.png" },
      boards: { main: "screenshots/main.png" },
    });
    expect(isPng(captured.files.get("screenshots/home.png"))).toBe(true);
    expect(isPng(captured.files.get("screenshots/main.png"))).toBe(true);
    expect(isPng(captured.files.get("screenshots/cover.png"))).toBe(true);
    expect(stderr).toContain("compiling styles");
    expect(stderr).toContain("capturing previews 2/2");
    expect(stderr).not.toContain("capturing previews 1/2");
    expect(stderr).toMatch(/uploading \d+ files \([\d.]+ (?:KB|MB)\)/);
    expect(stdout).not.toContain("capturing previews");
  },
  120_000,
);

test.skipIf(!hasChromium)(
  "--changed-since publishes the full design but captures only affected previews",
  async () => {
    const design = join(tmp, "velloo");
    await scaffold(design);
    await writeFile(
      join(design, "screens", "pricing.json"),
      JSON.stringify({
        id: "pricing",
        name: "Pricing",
        library: "default",
        tree: { $ref: "Box", children: [] },
      }),
    );
    await writeFile(
      join(design, "boards", "sales.json"),
      JSON.stringify({
        id: "sales",
        name: "Sales",
        frames: [{ id: "f2", screen: "pricing", x: 0, y: 0, w: 600, h: 400 }],
        groups: [],
      }),
    );
    await git(tmp, ["init", "-q", "-b", "main"]);
    await git(tmp, ["add", "."]);
    await git(tmp, ["commit", "-qm", "baseline"]);
    const baseline = await git(tmp, ["rev-parse", "HEAD"]);
    await writeFile(
      join(design, "screens", "home.json"),
      JSON.stringify({
        id: "home",
        name: "Home changed",
        library: "default",
        tree: { $ref: "Box", children: [{ $ref: "Text", props: { children: "Changed" } }] },
      }),
    );

    const { exitCode, stderr } = await runPublish(design, ["--changed-since", baseline]);
    if (exitCode !== 0) throw new Error(`publish failed (${exitCode}): ${stderr}`);

    expect(captured.design?.screenshots).toEqual({
      cover: "screenshots/cover.png",
      screens: { home: "screenshots/home.png" },
      boards: { main: "screenshots/main.png" },
    });
    const designJson = JSON.parse(new TextDecoder().decode(captured.files.get("design.json"))) as {
      screens: Array<{ id: string }>;
    };
    expect(designJson.screens.map((screen) => screen.id).sort()).toEqual(["home", "pricing"]);
    expect(captured.files.has("screenshots/pricing.png")).toBe(false);
    expect(captured.files.has("screenshots/sales.png")).toBe(false);
  },
);
