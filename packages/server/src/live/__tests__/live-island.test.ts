import { describe, expect, test } from "bun:test";
import { resolveLiveImportWarning } from "../component-bundler.ts";

/**
 * Live islands are for a dynamic leaf that cannot render statically. Aimed at a
 * route module they mount the application's own page inside the screen, which
 * scores like a perfect reproduction in `compare_to_url` and is not a design.
 */

describe("a live island pointed at a route module", () => {
  const config = { hostApp: { root: ".." } } as never;

  test("warns for a Next page, which reproduces the app instead of designing it", () => {
    const w = resolveLiveImportWarning("/tmp/x/velloo", config, "@/app/queue/page");
    expect(w).toContain("route module");
    expect(w).toContain("emit_code has nothing to write");
  });

  test("covers the other route filenames", () => {
    for (const p of [
      "@/app/layout",
      "@/app/queue/route.ts",
      "src/app/(marketing)/template.tsx",
      "@/app/default",
      "@/app/queue/loading",
      "@/pages/settings",
      "./pages/index.tsx",
      "~/app/routes/_index.tsx",
    ]) {
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

  test("a component named like a route file outside a route directory is not flagged", () => {
    for (const p of [
      "@/components/charts/layout",
      "@/components/default",
      "@/components/pages/PageList",
    ]) {
      expect(resolveLiveImportWarning("/tmp/x/velloo", config, p) ?? "").not.toContain(
        "route module",
      );
    }
  });

  test("the unknown-app warning still comes with the route warning", () => {
    const w = resolveLiveImportWarning("/tmp/x/velloo", config, "@/app/queue/page", "admin");
    expect(w).toContain("route module");
    expect(w).toContain('app "admin" is not a key of config.hostApps');
  });
});
