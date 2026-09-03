import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Server } from "bun";

type StubServer = Server<undefined>;

/**
 * `velloo publish` must ship the live-island bundle so a shared design renders
 * the host's real charts client-side instead of the placeholder skeleton. Under
 * the data-upload contract, publish uploads `design.json` (+ `snapshot.css`) and
 * — only when the folder declares `render:"live"` extensions — `bundle.js`,
 * flagging `live: true` + `bundlePath` in the design so the cloud's screen viewer
 * loads it. This drives the real command against an in-process stub cloud and
 * asserts that contract (no per-screen HTML is uploaded anymore).
 *
 * The stub host has no React, so the bundle compiles to an empty module; that's
 * fine — this guards publish's WIRING (build + upload + flag). The bundler's own
 * compile is covered in @velloo/server's component-bundler tests.
 */

interface CapturedDesign {
  live?: boolean;
  bundlePath?: string;
  snapshotCssPath?: string;
  extensions?: Record<string, unknown>;
  screens?: { id: string }[];
  themes?: Record<string, { name: string }>;
  boards?: Array<{
    id: string;
    theme?: string;
    frames: Array<{ id: string; scheme?: "light" | "dark" }>;
  }>;
}

const cliPath = resolve(import.meta.dir, "../cli.ts");

let tmp: string;
let server: StubServer;
let destinationBoardIds: string[];
let captured: {
  names: string[];
  /** Name typed loosely on purpose: a zero-byte part arrives with none. */
  parts: { name: string | undefined; size: number }[];
  design?: CapturedDesign;
  link?: Record<string, unknown>;
};

beforeEach(() => {
  tmp = join(tmpdir(), `velloo-pub-live-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  captured = { names: [], parts: [] };
  destinationBoardIds = [];
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const { pathname } = new URL(req.url);
      if (req.method === "GET" && pathname === "/v1/teams/mine") {
        return Response.json({ teams: [{ id: "team-123", name: "Design" }] });
      }
      if (req.method === "GET" && pathname === "/v1/publish-destinations") {
        return Response.json({
          effectiveTeamId: null,
          slots: [
            {
              slug: "test-slug",
              url: "/s/test-slug/",
              title: "Existing review",
              teamId: null,
              visibility: "public",
              passwordProtected: false,
              latestVersionId: "11111111-1111-4111-8111-111111111111",
              lastPublishedAt: "2030-01-01T00:00:00.000Z",
              context: {
                boardIds: destinationBoardIds,
                selectionFingerprint: "fingerprint",
                contextKnown: true,
                repo: null,
                branch: null,
              },
            },
          ],
        });
      }
      if (req.method === "POST" && pathname === "/v1/links") {
        captured.link = (await req.json()) as Record<string, unknown>;
        return Response.json(
          { slug: "test-slug", visibility: "public", passwordProtected: false },
          { status: captured.link.publishMode === "update" ? 200 : 201 },
        );
      }
      if (req.method === "PUT" && pathname === "/v1/links/test-slug/access") {
        return Response.json({ visibility: "public", passwordProtected: false });
      }
      if (req.method === "POST" && pathname.endsWith("/versions")) {
        const form = await req.formData();
        for (const value of form.getAll("file")) {
          if (value instanceof File) {
            const name = value.name as string | undefined;
            captured.parts.push({ name, size: value.size });
            if (name !== undefined) captured.names.push(name);
            if (value.name === "design.json") {
              captured.design = JSON.parse(await value.text()) as CapturedDesign;
            }
          }
        }
        return Response.json(
          { files: captured.names.length, bytes: 1, url: "/s/test-slug/" },
          {
            status: 201,
          },
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

async function scaffold(
  design: string,
  withLive: boolean,
  cssFramework?: "none",
  folderId?: string,
): Promise<void> {
  await mkdir(join(design, ".design"), { recursive: true });
  await mkdir(join(design, "theme"), { recursive: true });
  await mkdir(join(design, "screens"), { recursive: true });

  const extensions = withLive
    ? {
        Sparkline: {
          importPath: "@/components/charts",
          props: [],
          origin: "agent",
          render: "live",
          fit: "content",
        },
      }
    : {};
  await writeFile(
    join(design, ".design", "config.json"),
    JSON.stringify({
      schemaVersion: 3,
      toolVersion: "0.0.1",
      libraries: {
        default: { id: "none", version: "0.1.0", source: "binary", componentsPath: "binary" },
      },
      defaultLibrary: "default",
      ...(folderId ? { folderId } : {}),
      ...(cssFramework ? { styling: { framework: cssFramework } } : {}),
      extensions,
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
      tree: withLive
        ? { $ref: "Box", children: [{ $ref: "Sparkline", props: {} }] }
        : { $ref: "Box", children: [] },
    }),
  );
}

async function runPublish(
  design: string,
  extraArgs: string[] = [],
  destinationArgs: string[] = ["--new", "--slug", "test-slug"],
) {
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
      ...destinationArgs,
      "--public",
      // Screenshot capture has its own suites (publish-screenshots*.test.ts);
      // skipping it here keeps this wiring test fast and browser-free.
      "--no-screenshots",
      ...extraArgs,
    ],
    { cwd: resolve(import.meta.dir, "../../../.."), stdout: "pipe", stderr: "pipe" },
  );
  const exitCode = await proc.exited;
  const stderr = await new Response(proc.stderr).text();
  return { exitCode, stderr };
}

test("publish ships the live bundle and flags it in the design", async () => {
  const design = join(tmp, "velloo");
  await scaffold(design, true);
  const { exitCode, stderr } = await runPublish(design);
  if (exitCode !== 0) throw new Error(`publish failed (${exitCode}): ${stderr}`);

  // Data + deps, no per-screen HTML.
  expect(captured.names).toContain("design.json");
  expect(captured.names).toContain("snapshot.css");
  expect(captured.names).toContain("bundle.js");
  expect(captured.names.some((n) => n.endsWith(".html"))).toBe(false);

  // The design flags the live bundle so the cloud viewer loads it, and carries
  // the live extension + the screen that uses it.
  expect(captured.design?.live).toBe(true);
  expect(captured.design?.bundlePath).toBe("bundle.js");
  expect(captured.design?.extensions).toHaveProperty("Sparkline");
  expect(captured.design?.screens?.some((s) => s.id === "home")).toBe(true);
});

test("publish never uploads machine-local comment storage", async () => {
  const design = join(tmp, "velloo");
  const commentsPath = join(tmp, "machine-state", "comments.json");
  await scaffold(design, false, undefined, "folder-local-comment-boundary");
  await mkdir(join(tmp, "machine-state"), { recursive: true });
  await writeFile(
    commentsPath,
    JSON.stringify({
      version: 1,
      folderId: "folder-local-comment-boundary",
      threads: [{ body: "private session feedback must stay on this machine" }],
    }),
  );
  const previous = process.env.VELLOO_COMMENTS_PATH;
  process.env.VELLOO_COMMENTS_PATH = commentsPath;
  try {
    const { exitCode, stderr } = await runPublish(design);
    if (exitCode !== 0) throw new Error(`publish failed (${exitCode}): ${stderr}`);
  } finally {
    if (previous === undefined) delete process.env.VELLOO_COMMENTS_PATH;
    else process.env.VELLOO_COMMENTS_PATH = previous;
  }

  expect(captured.names.some((name) => name.includes("comment"))).toBe(false);
  expect(JSON.stringify(captured.design)).not.toContain("private session feedback");
});

test("publish preserves per-frame schemes in design.json", async () => {
  const design = join(tmp, "velloo");
  await scaffold(design, false);
  await mkdir(join(design, "boards"), { recursive: true });
  await writeFile(
    join(design, "boards", "main.json"),
    JSON.stringify({
      id: "main",
      name: "Main",
      frames: [{ id: "home-dark", screen: "home", x: 0, y: 0, w: 1440, h: 900, scheme: "dark" }],
      groups: [],
    }),
  );

  const { exitCode, stderr } = await runPublish(design);
  if (exitCode !== 0) throw new Error(`publish failed (${exitCode}): ${stderr}`);
  expect(captured.design?.boards?.[0]?.frames[0]?.scheme).toBe("dark");
});

test("publish preserves a board's pinned named theme in design.json", async () => {
  const design = join(tmp, "velloo");
  await scaffold(design, false);
  await mkdir(join(design, "boards"), { recursive: true });
  await writeFile(
    join(design, "theme", "velloo-cloud.json"),
    JSON.stringify({
      name: "velloo-cloud",
      colors: {
        background: "oklch(0.2 0.02 260)",
        foreground: "oklch(0.98 0 0)",
        primary: { DEFAULT: "oklch(0.7 0.15 40)", foreground: "oklch(0.15 0 0)" },
      },
      typography: {},
      spacing: {},
      radius: {},
    }),
  );
  await writeFile(
    join(design, "boards", "main.json"),
    JSON.stringify({
      id: "main",
      name: "Main",
      theme: "velloo-cloud",
      frames: [{ id: "home-dark", screen: "home", x: 0, y: 0, w: 1440, h: 900, scheme: "dark" }],
      groups: [],
    }),
  );

  const { exitCode, stderr } = await runPublish(design);
  if (exitCode !== 0) throw new Error(`publish failed (${exitCode}): ${stderr}`);

  expect(captured.design?.boards?.[0]?.theme).toBe("velloo-cloud");
  expect(captured.design?.boards?.[0]?.frames[0]?.scheme).toBe("dark");
  expect(captured.design?.themes?.["velloo-cloud"]?.name).toBe("velloo-cloud");
});

test("only referenced assets travel — snippets included, superseded ones not", async () => {
  const design = join(tmp, "velloo");
  await scaffold(design, false);
  await mkdir(join(design, "assets"), { recursive: true });
  await mkdir(join(design, "snippets"), { recursive: true });
  for (const name of ["current.png", "in-snippet.png", "superseded.png"]) {
    await writeFile(join(design, "assets", name), "not-really-a-png");
  }
  await writeFile(
    join(design, "screens", "home.json"),
    JSON.stringify({
      id: "home",
      name: "Home",
      library: "default",
      tree: {
        $ref: "Box",
        children: [{ $ref: "Image", props: { src: "/assets/current.png" } }, { $snippet: "card" }],
      },
    }),
  );
  // An image used only inside a snippet body still renders on every screen
  // that instantiates it, so it has to travel; scanning screens alone missed
  // it, and silently — the reference never reached the "not found" warning.
  await writeFile(
    join(design, "snippets", "card.json"),
    JSON.stringify({
      id: "card",
      name: "Card",
      params: [],
      tree: { $ref: "Image", props: { src: "/assets/in-snippet.png" } },
    }),
  );

  const { exitCode, stderr } = await runPublish(design);
  if (exitCode !== 0) throw new Error(`publish failed (${exitCode}): ${stderr}`);

  expect(captured.names).toContain("assets/current.png");
  expect(captured.names).toContain("assets/in-snippet.png");
  // A generation nothing points at any more stays home: publish carries what
  // the design references, so an image that was replaced simply isn't in it.
  expect(captured.names).not.toContain("assets/superseded.png");
});

test("publish omits the bundle when the folder has no live extensions", async () => {
  const design = join(tmp, "velloo");
  await scaffold(design, false);
  const { exitCode, stderr } = await runPublish(design);
  if (exitCode !== 0) throw new Error(`publish failed (${exitCode}): ${stderr}`);

  expect(captured.names).toContain("design.json");
  expect(captured.names).not.toContain("bundle.js");
  expect(captured.design?.live).toBe(false);
  expect(captured.design?.bundlePath).toBeUndefined();
});

/**
 * A folder with no CSS framework compiles to no stylesheet, and a zero-byte
 * multipart part reaches the receiver with NO filename at all — so the cloud
 * couldn't tell what the file was and 500'd on the whole publish. Every part
 * must therefore carry bytes, while the design still names its stylesheet.
 */
test("publish sends no empty parts for a folder with no CSS framework", async () => {
  const design = join(tmp, "velloo");
  await scaffold(design, false, "none");
  const { exitCode, stderr } = await runPublish(design);
  if (exitCode !== 0) throw new Error(`publish failed (${exitCode}): ${stderr}`);

  expect(captured.parts.filter((p) => p.size === 0)).toEqual([]);
  expect(captured.parts.every((p) => typeof p.name === "string")).toBe(true);
  expect(captured.names).toContain("snapshot.css");
  expect(captured.design?.snapshotCssPath).toBe("snapshot.css");
});

test("publish resolves a team name and sends its explicit team context", async () => {
  const design = join(tmp, "velloo");
  await scaffold(design, false);
  const { exitCode, stderr } = await runPublish(design, ["--team", "design"]);
  if (exitCode !== 0) throw new Error(`publish failed (${exitCode}): ${stderr}`);

  expect(captured.link).toMatchObject({ teamId: "team-123" });
});

test("noninteractive publish updates the exact matching slot", async () => {
  const design = join(tmp, "velloo");
  await scaffold(design, false, undefined, "folder-destination-123");
  const { exitCode, stderr } = await runPublish(design, [], ["--update"]);
  if (exitCode !== 0) throw new Error(`publish failed (${exitCode}): ${stderr}`);

  expect(captured.link).toMatchObject({
    folderId: "folder-destination-123",
    publishMode: "update",
    slug: "test-slug",
    expectedVersionId: "11111111-1111-4111-8111-111111111111",
  });
});

test("noninteractive publish refuses to guess when a folder already has a slot", async () => {
  const design = join(tmp, "velloo");
  await scaffold(design, false, undefined, "folder-destination-123");
  const { exitCode, stderr } = await runPublish(design, [], []);

  expect(exitCode).toBe(1);
  expect(stderr).toContain("pass --update or --new explicitly");
  expect(captured.link).toBeUndefined();
});

test("explicit update fails fast when no exact slot exists", async () => {
  destinationBoardIds = ["another-board"];
  const design = join(tmp, "velloo");
  await scaffold(design, false, undefined, "folder-destination-123");
  const { exitCode, stderr } = await runPublish(design, [], ["--update"]);

  expect(exitCode).toBe(1);
  expect(stderr).toContain("no exact published-design match");
  expect(stderr).toContain(`http://localhost:${server.port}/boards`);
  expect(captured.link).toBeUndefined();
  expect(captured.design).toBeUndefined();
});
