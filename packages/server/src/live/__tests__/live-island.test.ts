import { describe, expect, test } from "bun:test";
import { resolveLiveImportWarning } from "../component-bundler.ts";

/**
 * Live islands are for a dynamic leaf that cannot render statically. Aimed at a
 * route module they mount the application's own page inside the screen, which
 * scores like a perfect reproduction and is not a design — GPT-5.6 Terra did
 * exactly this in one eval run and reached 0.96 without composing anything.
 */

describe("a live island pointed at a route module", () => {
  const config = { hostApp: { root: ".." } } as never;

  test("warns for a Next page, which reproduces the app instead of designing it", () => {
    const w = resolveLiveImportWarning("/tmp/x/velloo", config, "@/app/queue/page");
    expect(w).toContain("route module");
    expect(w).toContain("emit_code has nothing to write");
  });

  test("covers the other route filenames", () => {
    for (const p of ["@/app/layout", "@/app/queue/route.ts", "./template.tsx", "@/app/default"]) {
      expect(resolveLiveImportWarning("/tmp/x/velloo", config, p)).toContain("route module");
    }
  });

  test("a real component is not flagged", () => {
    // `PriceChart` is the case live islands exist for.
    const w = resolveLiveImportWarning("/tmp/x/velloo", config, "@/components/charts/PriceChart");
    expect(w ?? "").not.toContain("route module");
  });

  test("a component whose name merely contains 'page' is not flagged", () => {
    const w = resolveLiveImportWarning("/tmp/x/velloo", config, "@/components/PageHeader");
    expect(w ?? "").not.toContain("route module");
  });
});
