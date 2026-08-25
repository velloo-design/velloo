import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverScanRoots, findScanRoot } from "../discover.ts";

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

describe("discoverScanRoots", () => {
  test("returns every React app in a monorepo, best-ranked first", async () => {
    await writePkg("apps/web", { next: "15.0.0", react: "19.0.0" });
    await writePkg("apps/admin", { react: "19.0.0" });
    await writePkg("packages/eslint-config", {}); // not React — ignored
    const found = await discoverScanRoots(root);
    expect(found.map((a) => a.rel).sort()).toEqual([join("apps", "admin"), join("apps", "web")]);
  });

  test("a React app root comes first, ahead of nested apps", async () => {
    await writePkg(".", { react: "19.0.0" });
    await writePkg("examples/demo", { react: "19.0.0" });
    const found = await discoverScanRoots(root);
    expect(found[0]?.rel).toBe("");
    expect(found[0]?.dir).toBe(root);
  });

  test("empty when nothing React-shaped exists", async () => {
    await writeFile(join(root, "requirements.txt"), "fastapi\n", "utf8");
    expect(await discoverScanRoots(root)).toEqual([]);
  });
});
