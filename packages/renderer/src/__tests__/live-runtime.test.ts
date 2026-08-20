import { describe, expect, test } from "bun:test";
import { LIVE_RUNTIME } from "../live-runtime.ts";

/**
 * The live runtime ships as a raw inlined JS string (no imports, no ESM —
 * it's injected into the design doc verbatim). Two of its behaviors are
 * load-bearing for chart fidelity and can't be exercised without a real DOM
 * + dynamic `import()` (covered end-to-end by the server's
 * `live-island.e2e.test.ts` under Playwright):
 *
 *   (a) reserving the real content height onto `fit:"content"` markers, so an
 *       out-of-flow mounted chart can't overflow its card; and
 *   (b) gating `__velloo_live_ready` on HEIGHT STABILITY across consecutive
 *       frames, not just DOM quiescence, so a multi-island grid's late
 *       reflow can't race the screenshot.
 *
 * Here we (1) regression-guard the mechanism at the string level — removing
 * either piece fails these — and (2) execute the one pure helper the gate
 * relies on (`sameHeights`) extracted from the actual shipped string, so the
 * comparison logic is tested for real with zero copy-drift.
 */

/** Pull a top-level `function <name>(...) { ... }` body out of the runtime string by brace-balancing. */
function extractFunction(name: string): string {
  const start = LIVE_RUNTIME.indexOf(`function ${name}`);
  if (start === -1) throw new Error(`function ${name} not found in LIVE_RUNTIME`);
  let depth = 0;
  let end = -1;
  for (let i = LIVE_RUNTIME.indexOf("{", start); i < LIVE_RUNTIME.length; i++) {
    const c = LIVE_RUNTIME[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end === -1) throw new Error(`unbalanced braces extracting ${name}`);
  return LIVE_RUNTIME.slice(start, end);
}

describe("LIVE_RUNTIME height reservation + stability gate", () => {
  test("reserves content height only for fit:'content' markers", () => {
    // The reservation must be gated on the marker opting out of the 16:9 lock.
    expect(LIVE_RUNTIME).toContain("data-live-fit");
    expect(LIVE_RUNTIME).toMatch(/getAttribute\(['"]data-live-fit['"]\)\s*!==\s*['"]content['"]/);
    // Reserved as a min-height (grow-only), measured from the mounted overlay.
    expect(LIVE_RUNTIME).toContain("data-live-mount");
    expect(LIVE_RUNTIME).toContain("minHeight");
    // Measured from the mounted children's extent (not the overlay's own box,
    // which an `inset:0` overlay pins to the marker height).
    expect(LIVE_RUNTIME).toContain("getBoundingClientRect");
  });

  test("reservation never shrinks a marker below its laid-out height", () => {
    // Guard the grow-only invariant: a smaller measurement is ignored so a
    // collapsed-to-skeleton measure can't shrink a correctly-sized marker.
    const src = extractFunction("reserveContentHeight");
    expect(src).toMatch(/measured\s*<=\s*current/);
  });

  test("ready gate requires height stability across frames, not just quiescence", () => {
    // The decision must compare two consecutive height snapshots before
    // flipping ready (deadline is the only escape hatch).
    expect(LIVE_RUNTIME).toContain("sameHeights");
    expect(LIVE_RUNTIME).toContain("prevHeights");
    expect(LIVE_RUNTIME).toContain("markReady");
    // Still bounded so a never-quiescing animation can't hang the gate.
    expect(LIVE_RUNTIME).toContain("DEADLINE_MS");
    expect(LIVE_RUNTIME).toMatch(/deadlineHit/);
  });

  test("sameHeights (extracted, real shipped code) compares snapshots exactly", () => {
    const sameHeights = new Function(
      `${extractFunction("sameHeights")}; return sameHeights;`,
    )() as (a: number[], b: number[]) => boolean;
    expect(sameHeights([100, 200, 300], [100, 200, 300])).toBe(true);
    // A single late-reflowing row (the bug) reads as unstable → not ready yet.
    expect(sameHeights([100, 200, 300], [100, 200, 340])).toBe(false);
    // Differing island counts never count as stable.
    expect(sameHeights([100], [100, 200])).toBe(false);
    expect(sameHeights([], [])).toBe(true);
  });
});
