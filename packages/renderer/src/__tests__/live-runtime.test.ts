import { describe, expect, test } from "bun:test";
import { CANVAS_SETTLED_EVENT } from "../canvas-runtime.ts";
import { READY_TIMEOUT_MS } from "../capture-settle.ts";
import { LIVE_GATE_MS, LIVE_ISLANDS_MS, LIVE_RUNTIME } from "../live-runtime.ts";

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

/** The delay argument of every `setTimeout(...)` call in the runtime string. */
function timerDelays(src: string): string[] {
  const delays: string[] = [];
  for (let at = src.indexOf("setTimeout("); at !== -1; at = src.indexOf("setTimeout(", at + 1)) {
    let depth = 0;
    let lastComma = -1;
    for (let i = at + "setTimeout".length; i < src.length; i++) {
      const c = src[i];
      if (c === "(" || c === "{" || c === "[") depth++;
      else if (c === ")" || c === "}" || c === "]") {
        depth--;
        if (depth === 0) {
          delays.push(src.slice(lastComma + 1, i).trim());
          break;
        }
      } else if (c === "," && depth === 1) lastComma = i;
    }
  }
  return delays;
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
    expect(extractFunction("settle(run, markers, deadline)")).toMatch(/deadlineHit/);
  });

  test("defers to the canvas mount when the document carries one", () => {
    // The mount replaces the body: markers found at parse time are in the SSR
    // copy it hides, and the ones it draws from each node's server render are
    // fresh and unmounted. So islands must mount after the mount settles, into
    // whichever tree owns the screen.
    expect(LIVE_RUNTIME).toContain("velloo-canvas-data");
    expect(LIVE_RUNTIME).toContain("__velloo_canvas_ready");
    expect(LIVE_RUNTIME).toContain("velloo-canvas-root");
    // And the gate is bounded, so a bundle that never commits can't park
    // `__velloo_live_ready` false and stall every capture.
    expect(extractFunction("awaitCanvasMount")).toContain(`GATE_MS = ${LIVE_GATE_MS};`);
  });

  test("a canvas mount that settles after the gate gets the islands remounted into it", () => {
    // The gate gave up and the islands went into the server render; a commit
    // after that hides it, so the runtime must follow ownership, not decide once.
    const gate = extractFunction("awaitCanvasMount");
    expect(gate).toContain(JSON.stringify(CANVAS_SETTLED_EVENT));
    expect(gate).toMatch(/owner\(\)\s*!==\s*mountedIn/);
    expect(LIVE_RUNTIME).not.toContain("{ once: true }");
    // The remount re-closes the flag for its own pass, and only the latest pass
    // may open it again.
    expect(extractFunction("mountIslands")).toContain("setReady(false)");
    expect(extractFunction("markReady")).toMatch(/run\s*===\s*pass/);
  });

  test("the live runtime's worst case fits inside the capture wait", () => {
    // Gate timeout, then one full island pass (import, mounts, settling): the
    // latest the first `__velloo_live_ready` can flip. Past the capture's
    // ceiling, a capture would fire on islands that had not mounted.
    expect(LIVE_GATE_MS + LIVE_ISLANDS_MS).toBeLessThan(READY_TIMEOUT_MS);
    // The pass enforces its ceiling with one deadline, used by both the
    // hung-import timer and the settle loop.
    const mount = extractFunction("mount(run, markers)");
    expect(mount).toContain(`ISLANDS_MS = ${LIVE_ISLANDS_MS};`);
    expect(mount).toMatch(/markReady\(run\);\s*\},\s*ISLANDS_MS\)/);
    expect(extractFunction("settle(run, markers, deadline)")).toMatch(/now\s*>=\s*deadline/);
    // No other timer in the runtime may stretch a pass beyond those two.
    const timers = timerDelays(LIVE_RUNTIME);
    expect(timers).toContain("GATE_MS");
    expect(timers).toContain("ISLANDS_MS");
    for (const t of timers) expect(["GATE_MS", "ISLANDS_MS", "0"]).toContain(t);
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
