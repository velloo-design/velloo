import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { createPrefsRouter } from "../prefs.ts";

/**
 * The canvas's cross-run memory. It lives in the person's prefs file, not the
 * browser: every daemon serves the canvas from its own port, so a flag kept per
 * origin would be forgotten by the next design — and dismissed hints would return.
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
  test("no hint is dismissed until the canvas says so", async () => {
    const server = app();
    expect(await (await server.request("/api/prefs")).json()).toEqual({ hintsSeen: [] });

    const saved = await post(server, { dismissHints: ["agent"] });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ hintsSeen: ["agent"] });
    // A second daemon (another port, another design) reads the same file.
    expect(await (await app().request("/api/prefs")).json()).toEqual({ hintsSeen: ["agent"] });
  });

  test("dismissing adds to the list, and a reset clears it", async () => {
    await post(app(), { dismissHints: ["agent"] });
    await post(app(), { dismissHints: ["board", "agent"] });
    expect(await (await app().request("/api/prefs")).json()).toEqual({
      hintsSeen: ["agent", "board"],
    });
    expect(await (await post(app(), { resetHints: true })).json()).toEqual({ hintsSeen: [] });
  });

  test("keeps the rest of the prefs file as it was", async () => {
    await writeFile(path, JSON.stringify({ version: 1, feedbackContactOk: true }));
    await post(app(), { dismissHints: ["board"] });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      version: 1,
      feedbackContactOk: true,
      canvasHintsSeen: ["board"],
    });
  });

  test("refuses a body it doesn't know", async () => {
    expect((await post(app(), { dismissHints: "agent" })).status).toBe(400);
    expect((await post(app(), { dismissHints: ["../../etc"] })).status).toBe(400);
    expect((await post(app(), { theme: "dark" })).status).toBe(400);
  });
});
