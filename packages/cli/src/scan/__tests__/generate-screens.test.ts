import { describe, expect, test } from "bun:test";
import { registry as noneRegistry } from "@velloo/provider-none";
import { registry as shadcnRegistry } from "@velloo/shadcn-snapshot";
import { buildBoardsFromScan, buildScreensFromScan } from "../generate-screens.ts";
import type { ScannedRoute } from "../types.ts";

function route(routePath: string, appRel?: string): ScannedRoute {
  const id = routePath === "/" ? "index" : routePath.slice(1).replace(/\//g, "-");
  return {
    id: appRel ? `${appRel.replace(/\//g, "-")}-${id}` : id,
    name: id,
    routePath,
    sourceFile: `src/pages${routePath === "/" ? "/index" : routePath}.tsx`,
    ...(appRel ? { appRel } : {}),
  };
}

const ROUTE: ScannedRoute = {
  id: "dashboard",
  name: "Dashboard",
  routePath: "/dashboard",
  sourceFile: "app/dashboard/page.tsx",
};

function collectRefs(node: unknown, out: Set<string>): void {
  if (!node || typeof node !== "object") return;
  const n = node as { $ref?: unknown; children?: unknown };
  if (typeof n.$ref === "string") out.add(n.$ref);
  if (Array.isArray(n.children)) for (const c of n.children) collectRefs(c, out);
}

/**
 * The placeholder tree must only reference components the *active* provider
 * actually registers, or a scanned folder renders an "Unknown component" error
 * in the canvas. The trees never render in unit tests, so this guards the refs
 * directly against each provider's registry.
 */
describe("scan placeholder refs are renderable", () => {
  test("shadcn (hasBadge) screens reference only snapshot-registry components", () => {
    const [screen] = buildScreensFromScan({ routes: [ROUTE], hasBadge: true });
    const refs = new Set<string>();
    collectRefs(screen?.tree, refs);
    expect(refs.size).toBeGreaterThan(0);
    for (const ref of refs) expect(Object.keys(shadcnRegistry)).toContain(ref);
  });

  test("no-lib (no Badge) screens reference only none-registry components", () => {
    const [screen] = buildScreensFromScan({ routes: [ROUTE], hasBadge: false });
    const refs = new Set<string>();
    collectRefs(screen?.tree, refs);
    expect(refs.size).toBeGreaterThan(0);
    for (const ref of refs) expect(Object.keys(noneRegistry)).toContain(ref);
  });
});

describe("buildBoardsFromScan", () => {
  test("few routes keep the historical flat single board", () => {
    const boards = buildBoardsFromScan({
      routes: [route("/"), route("/about"), route("/pricing")],
    });
    expect(boards).toHaveLength(1);
    expect(boards[0]?.id).toBe("app");
    expect(boards[0]?.groups).toEqual([]);
    expect(boards[0]?.frames.map((f) => f.screen)).toEqual(["index", "about", "pricing"]);
    // 3-column grid, one row.
    expect(new Set(boards[0]?.frames.map((f) => f.y)).size).toBe(1);
  });

  test("repeated route sections become board groups in separate bands", () => {
    const boards = buildBoardsFromScan({
      routes: [
        route("/"),
        route("/pricing"),
        route("/settings/profile"),
        route("/settings/billing"),
        route("/blog/first"),
        route("/blog/second"),
      ],
    });
    expect(boards).toHaveLength(1);
    const board = boards[0];
    expect(board?.groups.map((g) => g.name).sort()).toEqual(["Blog", "Settings"]);

    const frameByScreen = new Map(board?.frames.map((f) => [f.screen, f]));
    const settingsGroup = board?.groups.find((g) => g.name === "Settings")?.id;
    expect(frameByScreen.get("settings-profile")?.group).toBe(settingsGroup as string);
    expect(frameByScreen.get("settings-billing")?.group).toBe(settingsGroup as string);
    // Singles ("/", "/pricing") stay ungrouped in the leading band.
    expect(frameByScreen.get("index")?.group).toBeUndefined();
    expect(frameByScreen.get("pricing")?.group).toBeUndefined();
    // Each band sits strictly below the previous one.
    const singleY = frameByScreen.get("index")?.y ?? 0;
    const settingsY = frameByScreen.get("settings-profile")?.y ?? 0;
    const blogY = frameByScreen.get("blog-first")?.y ?? 0;
    expect(settingsY).toBeGreaterThan(singleY);
    expect(blogY).not.toBe(settingsY);
  });

  test("a multi-app scan yields one board per app", () => {
    const boards = buildBoardsFromScan({
      routes: [
        route("/", "apps/web"),
        route("/pricing", "apps/web"),
        route("/", "apps/admin"),
        route("/users", "apps/admin"),
      ],
    });
    expect(boards.map((b) => [b.id, b.name]).sort()).toEqual([
      ["apps-admin", "apps/admin"],
      ["apps-web", "apps/web"],
    ]);
    const web = boards.find((b) => b.id === "apps-web");
    expect(web?.frames.map((f) => f.screen)).toEqual(["apps-web-index", "apps-web-pricing"]);
  });
});
