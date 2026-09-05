import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { createProvider as createShadcnProvider } from "@velloo/provider-shadcn-upstream";
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
const SHADCN_APP = resolve(import.meta.dir, "../../../provider-mui");
const SHADCN_FIXTURE = join(import.meta.dir, "fixtures/shadcn-host");

const MUI_SPEC: CanvasBundleSpec = {
  components: (ids) =>
    ids.map((id) => ({
      id,
      sources: [{ importPath: `@mui/material/${id}`, exportName: id, fidelity: "exact" }],
    })),
  overlayIds: ["Dialog", "Menu", "Popover", "Drawer", "Snackbar"],
  styleRuntime: { kind: "emotion", cacheKey: "vmui", stylesModule: "@mui/material/styles" },
};

describe("buildCanvasBundle", () => {
  // Skipped under VELLOO_E2E: canvas-mount.e2e.test.ts performs this exact
  // full-spec build in its beforeAll (throwing on any error), and a Bun
  // test-runner bug poisons Bun.build across test files — after one large
  // build in another file, the next build fails with spurious
  // EISDIR/"Unexpected reading file" on real node_modules files (repro:
  // full-MUI-spec build in file A, any build in file B, `bun test A B`).
  // Coverage is identical either way; this dodges the double-build.
  test.skipIf(process.env.VELLOO_E2E === "1")(
    "bundles the host's real MUI + emotion into a mountScreen module",
    async () => {
      const ids = ["Box", "Paper", "Card", "CardContent", "Button", "Typography", "DialogTitle"];
      const { code, errors } = await buildCanvasBundle(HOST_ROOT, MUI_SPEC, ids);
      expect(errors).toEqual([]);
      // A real, non-trivial browser bundle (not the empty fallback stub).
      expect(code).toContain("mountScreen");
      expect(code.length).toBeGreaterThan(20_000);
      // The interpreter + overlay shims made it in.
      expect(code).toContain("createTheme");
    },
    30_000,
  );

  test("missing host framework ⇒ empty module + structured errors, never throws", async () => {
    const bogus: CanvasBundleSpec = {
      ...MUI_SPEC,
      components: (ids) =>
        ids.map((id) => ({
          id,
          sources: [{ importPath: `@no-such/ui-kit-xyz/${id}`, fidelity: "exact" }],
        })),
    };
    const result = await buildCanvasBundle(HOST_ROOT, bogus, ["Button"]);
    // A ref with no usable source is NOT mounted: client-rendering a placeholder
    // would also hide the SSR body that rendered it correctly. The caller keeps
    // SSR and the reason is reported per component.
    expect(result.usable).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ id: "Button", status: "unavailable" }),
    ]);
    expect(result.errors.length).toBeGreaterThan(0);
  }, 30_000);

  test("a ref the provider knows nothing about keeps the screen on SSR", async () => {
    const provider = createShadcnProvider({
      hostAppRoot: SHADCN_APP,
      cacheDir: join(SHADCN_FIXTURE, "src/components"),
    });
    const spec = provider.canvasBundleSpec;
    if (!spec) throw new Error("shadcn provider has no canvas bundle spec");
    const result = await buildCanvasBundle(
      SHADCN_APP,
      spec,
      ["Button", "NotAComponent"],
      [{ from: "@/", to: "../server/src/__tests__/fixtures/shadcn-host/src/" }],
    );
    expect(result.usable).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "NotAComponent", status: "unavailable" }),
      ]),
    );
  }, 30_000);

  test("an empty ref set is not a usable mount", async () => {
    const result = await buildCanvasBundle(HOST_ROOT, MUI_SPEC, []);
    expect(result.usable).toBe(false);
  }, 30_000);

  test("a provider whose components() rejects returns errors instead of throwing", async () => {
    const exploding: CanvasBundleSpec = {
      ...MUI_SPEC,
      components: () => Promise.reject(new Error("corrupt manifest.json")),
    };
    const result = await buildCanvasBundle(HOST_ROOT, exploding, ["Button"]);
    expect(result.usable).toBe(false);
    expect(result.errors).toEqual([
      expect.objectContaining({ message: expect.stringContaining("corrupt manifest.json") }),
    ]);
  }, 30_000);

  test("mixes exact repo source, adapted overlays, helpers, and a broken-file fallback", async () => {
    const provider = createShadcnProvider({
      hostAppRoot: SHADCN_APP,
      cacheDir: join(SHADCN_FIXTURE, "src/components"),
    });
    const spec = provider.canvasBundleSpec;
    if (!spec) throw new Error("shadcn provider has no canvas bundle spec");
    const result = await buildCanvasBundle(
      SHADCN_APP,
      spec,
      ["Button", "Card", "CardHeader", "CardTitle", "CardContent", "Badge", "Dialog", "Heading"],
      [{ from: "@/", to: "../server/src/__tests__/fixtures/shadcn-host/src/" }],
    );
    expect(result.usable).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "Button", status: "exact" }),
        expect.objectContaining({ id: "CardContent", status: "exact" }),
        expect.objectContaining({ id: "Badge", status: "fallback" }),
        expect.objectContaining({ id: "Dialog", status: "adapted" }),
        expect.objectContaining({ id: "Heading", status: "fallback" }),
      ]),
    );
    expect(
      result.diagnostics.find((entry) => entry.id === "Badge")?.errors?.length,
    ).toBeGreaterThan(0);
    expect(result.code.length).toBeGreaterThan(50_000);
  }, 30_000);
});
