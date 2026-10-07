import { describe, expect, test } from "bun:test";
import { createCanvasRouter } from "../../routes/bundles.ts";
import { budgetWarning, type CanvasBundleResult } from "../canvas-bundle.ts";
import type { CanvasBundler } from "../canvas-bundler.ts";

/**
 * A bundle past its budget is slow, not broken.
 *
 * It once was both: the over-budget notice was filed with the build errors,
 * the bundle route hands those to the browser as "the build failed", and the
 * mount stays on the server render when it sees them. So a Mantine screen 0.3
 * MB over drew every component as a labelled frame — in the canvas and in
 * every capture — while the daemon, which had built a perfectly good bundle,
 * reported the screen as mounted.
 */

const CODE = "export function mountScreen() {}\n";

function routerFor(result: Partial<CanvasBundleResult>) {
  const bundler = {
    build: async () => ({ code: CODE, errors: [], usable: true, diagnostics: [], ...result }),
  } as unknown as CanvasBundler;
  return createCanvasRouter(bundler, () => "default");
}

describe("the canvas bundle budget", () => {
  test("within budget says nothing", () => {
    expect(budgetWarning({ buildMs: 300, bytes: 2_000_000 })).toBeNull();
    expect(budgetWarning({ buildMs: 8000, bytes: 6_000_000 })).toBeNull();
  });

  test("past either limit names both measurements and says the bundle still mounts", () => {
    const heavy = budgetWarning({ buildMs: 324, bytes: 6_406_104 });
    expect(heavy?.message).toContain("over budget (324 ms, 6.4 MB; budget 8000 ms, 6.0 MB)");
    expect(heavy?.message).toContain("still mounts");
    expect(budgetWarning({ buildMs: 9000, bytes: 1000 })?.message).toContain("9000 ms");
  });

  test("an over-budget bundle is served as it was built, so the browser mounts it", async () => {
    const warning = budgetWarning({ buildMs: 324, bytes: 6_406_104 });
    if (!warning) throw new Error("expected a warning");
    const router = routerFor({ warnings: [warning] });
    expect(await (await router.request("/bundle.js?refs=Button")).text()).toBe(CODE);
    const status = (await (await router.request("/status?refs=Button")).json()) as {
      errors: unknown[];
      warnings?: { message: string }[];
    };
    expect(status.errors).toEqual([]);
    expect(status.warnings?.[0]?.message).toContain("over budget");
  });

  test("a build that failed still tells the browser so", async () => {
    const router = routerFor({ usable: false, errors: [{ message: "Could not resolve react" }] });
    const body = await (await router.request("/bundle.js?refs=Button")).text();
    expect(body).toContain("__velloo_canvas_build_errors");
    expect(body).toContain("Could not resolve react");
  });
});
