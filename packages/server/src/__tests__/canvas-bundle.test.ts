import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { buildCanvasBundle, type CanvasBundleSpec } from "../live/canvas-bundle.ts";

/**
 * The framework-native canvas bundle (#18 — render the installed components):
 * proves the hardest technical risk — that we can Bun.build the host app's real
 * @mui/material + emotion + React into one self-contained browser ESM exporting
 * `mountScreen`. Uses the monorepo root as the "host app" (it has @mui/material
 * hoisted, since provider-mui depends on it).
 */

// A dir that resolves @mui/material + @emotion + react like a real MUI app —
// provider-mui depends on exactly those. (server's __tests__ → ../../../provider-mui)
const HOST_ROOT = resolve(import.meta.dir, "../../../provider-mui");

const MUI_SPEC: CanvasBundleSpec = {
  moduleBase: "@mui/material",
  componentIds: ["Box", "Paper", "Card", "CardContent", "Button", "Typography", "DialogTitle"],
  overlayIds: ["Dialog", "Menu", "Popover", "Drawer", "Snackbar"],
  emotionKey: "vmui",
  stylesModule: "@mui/material/styles",
};

describe("buildCanvasBundle", () => {
  test("bundles the host's real MUI + emotion into a mountScreen module", async () => {
    const { code, errors } = await buildCanvasBundle(HOST_ROOT, MUI_SPEC);
    expect(errors).toEqual([]);
    // A real, non-trivial browser bundle (not the empty fallback stub).
    expect(code).toContain("mountScreen");
    expect(code.length).toBeGreaterThan(20_000);
    // The interpreter + overlay shims made it in.
    expect(code).toContain("createTheme");
  }, 30_000);

  test("missing host framework ⇒ empty module + structured errors, never throws", async () => {
    const bogus: CanvasBundleSpec = { ...MUI_SPEC, moduleBase: "@no-such/ui-kit-xyz" };
    const { code, errors } = await buildCanvasBundle(HOST_ROOT, bogus);
    // React/emotion still resolve, but no components do → empty stub + errors.
    expect(code).toContain("mountScreen() {}");
    expect(errors.length).toBeGreaterThan(0);
  }, 30_000);
});
