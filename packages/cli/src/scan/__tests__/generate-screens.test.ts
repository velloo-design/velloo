import { describe, expect, test } from "bun:test";
import { registry as noneRegistry } from "@velloo/provider-none";
import { registry as shadcnRegistry } from "@velloo/shadcn-snapshot";
import { buildScreensFromScan } from "../generate-screens.ts";
import type { ScannedRoute } from "../types.ts";

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
