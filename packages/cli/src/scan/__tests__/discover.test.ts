import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findScanRoot, resolveScanRoot } from "../discover.ts";

let root: string;

async function writePkg(rel: string, deps: Record<string, string>): Promise<void> {
  const dir = join(root, rel);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "package.json"), JSON.stringify({ dependencies: deps }), "utf8");
}

beforeEach(async () => {
  // Outside any git work tree, so discovery exercises the readdir-walk fallback.
  root = join(tmpdir(), `velloo-discover-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(root, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("findScanRoot", () => {
  test("returns the app root itself when it holds a React app", async () => {
    await writePkg(".", { react: "19.0.0" });
    expect(await findScanRoot(root)).toBe(root);
  });

  test("finds a nested UI folder when the root has no package.json", async () => {
    // A Python repo: backend at the root (no package.json), UI in web/frontend.
    await writeFile(join(root, "requirements.txt"), "fastapi\n", "utf8");
    await writePkg("web/frontend", { next: "15.0.0", react: "19.0.0" });
    expect(await findScanRoot(root)).toBe(join(root, "web", "frontend"));
  });

  test("ignores non-React JS packages", async () => {
    await writePkg("api", { express: "4.0.0" });
    expect(await findScanRoot(root)).toBeNull();
  });

  test("prefers the shallowest React app, then a conventional UI dir name", async () => {
    await writePkg("packages/admin", { react: "19.0.0" }); // depth 2
    await writePkg("frontend", { react: "19.0.0" }); // depth 1, preferred name
    expect(await findScanRoot(root)).toBe(join(root, "frontend"));
  });
});

describe("resolveScanRoot", () => {
  test("an explicit scanDir wins and is not flagged as auto-discovered", async () => {
    const r = await resolveScanRoot(root, "web/frontend");
    expect(r.scanRoot).toBe(join(root, "web", "frontend"));
    expect(r.relToApp).toBe(join("web", "frontend"));
    expect(r.autoDiscovered).toBe(false);
  });

  test("auto-discovers a nested UI folder when no scanDir is given", async () => {
    await writePkg("web/frontend", { react: "19.0.0" });
    const r = await resolveScanRoot(root);
    expect(r.scanRoot).toBe(join(root, "web", "frontend"));
    expect(r.autoDiscovered).toBe(true);
  });

  test("falls back to the app root when discovery finds nothing", async () => {
    await writeFile(join(root, "requirements.txt"), "fastapi\n", "utf8");
    const r = await resolveScanRoot(root);
    expect(r.scanRoot).toBe(root);
    expect(r.relToApp).toBe("");
    expect(r.autoDiscovered).toBe(false);
  });
});
