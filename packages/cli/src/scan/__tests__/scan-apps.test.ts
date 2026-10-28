import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appPrefixes, scanApps } from "../scan-apps.ts";

let root: string;

async function writeApp(rel: string, pages: string[]): Promise<void> {
  const dir = join(root, rel);
  await mkdir(join(dir, "src", "pages"), { recursive: true });
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ dependencies: { react: "19.0.0", vite: "6.0.0" } }),
    "utf8",
  );
  for (const page of pages) {
    const file = join(dir, "src", "pages", `${page}.tsx`);
    await mkdir(join(file, ".."), { recursive: true });
    await writeFile(file, "export default () => null;\n", "utf8");
  }
}

beforeEach(async () => {
  root = join(tmpdir(), `velloo-scan-apps-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(root, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("scanApps", () => {
  test("a single app scans without prefixes or appRel", async () => {
    await writeApp(".", ["index", "about"]);
    const { apps, routes } = await scanApps(root);
    expect(apps).toHaveLength(1);
    expect(routes.map((r) => r.id).sort()).toEqual(["about", "index"]);
    expect(routes.every((r) => r.appRel === undefined)).toBe(true);
  });

  test("a monorepo scans every app, prefixing ids and names per app", async () => {
    await writeApp("apps/web", ["index", "pricing"]);
    await writeApp("apps/admin", ["index", "users"]);
    const { apps, routes } = await scanApps(root);
    expect(apps).toHaveLength(2);
    expect(routes.map((r) => r.id).sort()).toEqual([
      "admin-index",
      "admin-users",
      "web-index",
      "web-pricing",
    ]);
    const webIndex = routes.find((r) => r.id === "web-index");
    expect(webIndex?.name).toBe("Web / Home");
    expect(webIndex?.appRel).toBe("apps/web");
  });

  test("an explicit scanDir bypasses discovery and scans one app unprefixed", async () => {
    await writeApp("apps/web", ["index"]);
    await writeApp("apps/admin", ["index"]);
    const { apps, routes } = await scanApps(root, "apps/admin");
    expect(apps).toHaveLength(1);
    expect(routes.map((r) => r.id)).toEqual(["index"]);
  });

  test("an app with no routes to find is still an app to read", async () => {
    // A single-page site with no router: nothing to list, and a UI library all the same.
    await writeApp(".", []);
    const { apps, routes, roots } = await scanApps(root);
    expect(apps).toEqual([]);
    expect(routes).toEqual([]);
    expect(roots).toEqual([{ dir: root, rel: "" }]);
  });

  test("a directory with no app in it has no roots, itself included", async () => {
    // Scanned for routes all the same, but it must not read as an app that was found.
    await writeFile(join(root, "README.md"), "# notes\n", "utf8");
    expect((await scanApps(root)).roots).toEqual([]);
  });

  test("every app is a root, routes or not, the one with routes first only by rank", async () => {
    await writeApp("apps/web", ["index"]);
    await writeApp("apps/admin", []);
    const { apps, roots } = await scanApps(root);
    expect(apps.map((app) => app.rel)).toEqual(["apps/web"]);
    expect(roots.map((r) => r.rel).sort()).toEqual(["apps/admin", "apps/web"]);
  });

  test("an explicit scanDir is the one root, whatever else the repo holds", async () => {
    await writeApp("apps/web", ["index"]);
    await writeApp("apps/admin", []);
    const { roots } = await scanApps(root, "apps/admin");
    expect(roots).toEqual([{ dir: join(root, "apps", "admin"), rel: "apps/admin" }]);
  });
});

describe("appPrefixes", () => {
  test("uses the last path segment, widening on collision", () => {
    const prefixes = appPrefixes(["apps/web", "tools/web", "apps/admin"]);
    expect(prefixes.get("apps/web")).toBe("apps-web");
    expect(prefixes.get("tools/web")).toBe("tools-web");
    expect(prefixes.get("apps/admin")).toBe("admin");
  });
});
