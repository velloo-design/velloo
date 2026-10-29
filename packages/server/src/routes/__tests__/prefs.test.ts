import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { createPrefsRouter } from "../prefs.ts";

/**
 * The canvas's cross-run memory. It lives in the person's prefs file, not the
 * browser: every daemon serves the canvas from its own port, so a flag kept per
 * origin would be forgotten by the next design — and the tour would replay.
 */

let dir: string;
let path: string;
const previous = process.env.VELLOO_PREFS_PATH;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "velloo-prefs-"));
  path = join(dir, "prefs.json");
  process.env.VELLOO_PREFS_PATH = path;
});

afterEach(async () => {
  if (previous === undefined) delete process.env.VELLOO_PREFS_PATH;
  else process.env.VELLOO_PREFS_PATH = previous;
  await rm(dir, { recursive: true, force: true });
});

function app(): Hono {
  const root = new Hono();
  root.route("/api/prefs", createPrefsRouter());
  return root;
}

const post = (server: Hono, body: unknown) =>
  server.request("/api/prefs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("prefs route", () => {
  test("the tour is unseen until the canvas says otherwise", async () => {
    const server = app();
    expect(await (await server.request("/api/prefs")).json()).toEqual({ tourSeen: false });

    const saved = await post(server, { tourSeen: true });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ tourSeen: true });
    // A second daemon (another port, another design) reads the same file.
    expect(await (await app().request("/api/prefs")).json()).toEqual({ tourSeen: true });
  });

  test("keeps the rest of the prefs file as it was", async () => {
    await writeFile(path, JSON.stringify({ version: 1, feedbackContactOk: true }));
    await post(app(), { tourSeen: true });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      version: 1,
      feedbackContactOk: true,
      canvasTourSeen: true,
    });
  });

  test("refuses a body it doesn't know", async () => {
    const res = await post(app(), { tourSeen: "yes" });
    expect(res.status).toBe(400);
    expect((await post(app(), { theme: "dark" })).status).toBe(400);
  });
});
