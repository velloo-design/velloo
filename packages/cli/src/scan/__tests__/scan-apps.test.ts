import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appPrefixes, primaryApp, scanApps } from "../scan-apps.ts";
import type { AppScan, ScannedRoute } from "../types.ts";

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
    expect(webIndex?.appRel).toBe(join("apps", "web"));
  });

  test("an explicit scanDir bypasses discovery and scans one app unprefixed", async () => {
    await writeApp("apps/web", ["index"]);
    await writeApp("apps/admin", ["index"]);
    const { apps, routes } = await scanApps(root, "apps/admin");
    expect(apps).toHaveLength(1);
    expect(routes.map((r) => r.id)).toEqual(["index"]);
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

describe("primaryApp", () => {
  const app = (rel: string): AppScan => ({ dir: `/x/${rel}`, rel, framework: "vite", routes: [] });
  const sel = (appRel: string): ScannedRoute => ({
    id: "x",
    name: "X",
    routePath: "/x",
    sourceFile: "x.tsx",
    appRel,
  });

  test("picks the app contributing most selected routes", () => {
    const apps = [app("apps/web"), app("apps/admin")];
    const picked = primaryApp(apps, [sel("apps/admin"), sel("apps/admin"), sel("apps/web")]);
    expect(picked?.rel).toBe("apps/admin");
  });

  test("rank order breaks ties (and wins with no selection)", () => {
    const apps = [app("apps/web"), app("apps/admin")];
    expect(primaryApp(apps, [])?.rel).toBe("apps/web");
  });
});
