import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Config } from "@velloo/schema";
import { repoKey } from "@velloo/schema";
import { pathKey } from "../../live/bundle-core.ts";
import { CanvasBundler } from "../../live/canvas-bundler.ts";
import { RepoComponents } from "../catalog.ts";
import { fixtureApp } from "./fixture-app.ts";

let app: Awaited<ReturnType<typeof fixtureApp>>;
let FIXTURE: string;
let linkDir: string;
/** The same app reached through a symlink, as a symlinked checkout is. */
let LINKED: string;
beforeAll(async () => {
  app = await fixtureApp();
  FIXTURE = realpathSync.native(app.root);
  linkDir = await mkdtemp(join(tmpdir(), "velloo-repo-link-"));
  LINKED = join(linkDir, "app");
  await symlink(FIXTURE, LINKED, "junction");
});
afterAll(async () => {
  await app.cleanup();
  await rm(linkDir, { recursive: true, force: true });
});

function setup(root = FIXTURE) {
  const repo = new RepoComponents({
    folderRoot: resolve(root, "velloo"),
    config: () => ({ hostApp: { root } }) as unknown as Config,
    reservedIds: () => new Set(),
  });
  // No provider spec at all: repository components mount on their own.
  const bundler = new CanvasBundler(
    root,
    () => ({ root }),
    () => undefined,
    false,
    { repo },
  );
  return { repo, bundler };
}

const key = (importPath: string, exportName: string, member?: string) =>
  repoKey({ importPath, exportName, ...(member ? { member } : {}) });

describe("repository components in the canvas bundle", () => {
  test("each component resolves on its own: one broken import costs only itself", async () => {
    const { bundler } = setup();
    const keys = [
      key("./src/components", "StatCard"),
      key("./src/components", "Panel", "Header"),
      key("./src/components/hero", "default"),
      key("./src/components/broken", "Broken"),
      key("./src/components/nope", "Nope"),
      key("./src/server/report", "renderReport"),
    ];
    const result = await bundler.build("default", keys);
    expect(result.usable).toBe(true);
    const status = Object.fromEntries(result.diagnostics.map((d) => [d.id, [d.status, d.code]]));
    expect(status).toEqual({
      [keys[0] as string]: ["exact", undefined],
      [keys[1] as string]: ["exact", undefined],
      [keys[2] as string]: ["exact", undefined],
      [keys[3] as string]: ["unavailable", "compile-failed"],
      [keys[4] as string]: ["unavailable", "resolve-failed"],
      [keys[5] as string]: ["unavailable", "server-only"],
    });
    const broken = result.diagnostics.find((d) => d.id === keys[3]);
    expect(broken?.remedy).toBeDefined();
    expect(broken?.preview).toBe("preview.jsx");
    // The preview entry's stylesheet travels with the bundle.
    expect(result.code).toContain("data-velloo-canvas-css");
    expect(result.code).toContain("--fixture-accent");
    expect(result.metrics?.bytes).toBeGreaterThan(0);
  }, 60_000);

  test("a non-repository ref with no browser source falls back to its server render", async () => {
    const { bundler } = setup();
    const result = await bundler.build("default", ["Box", key("./src/components", "StatCard")]);
    expect(result.usable).toBe(true);
    expect(result.staticRefs).toEqual(["Box"]);
    expect(result.diagnostics.find((d) => d.id === "Box")).toMatchObject({
      status: "fallback",
      code: "static-fallback",
    });
  }, 60_000);

  test("without repository refs, a provider-less library still does not mount", async () => {
    const { bundler } = setup();
    expect(bundler.canMount("default", ["Box"])).toBe(false);
    expect((await bundler.build("default", ["Box"])).usable).toBe(false);
  });

  test("an edit invalidates only the bundles that compiled the edited file", async () => {
    const { bundler } = setup();
    await bundler.build("default", [key("./src/components", "StatCard")]);
    const hero = await bundler.build("default", [key("./src/components/hero", "default")]);
    expect(bundler.size).toBe(2);
    // The file it compiled, spelled the way an edit to it will arrive. A
    // bundler's own spelling differs by platform (`/C:/…` on Windows), and a
    // mismatch doesn't fail here — it stops invalidating, and the canvas serves
    // a bundle built from source that has since changed.
    expect(hero.inputs).toContain(pathKey(resolve(FIXTURE, "src/components/hero.tsx")));
    const version = bundler.version;
    bundler.invalidate([resolve(FIXTURE, "src/components/hero.tsx")]);
    expect(bundler.size).toBe(1);
    expect(bundler.version).toBe(version + 1);
    bundler.invalidate([resolve(FIXTURE, "README.md")]);
    expect(bundler.size).toBe(1);
  }, 60_000);

  test("an edit spelled through a symlinked host root still invalidates", async () => {
    // Bundle inputs are canonical; a watcher spells files from the host root
    // as configured. Through a symlink (macOS's /var, a symlinked checkout) or
    // a Windows 8.3 short name the two differ, and a mismatch reads as
    // "nothing compiled this file" — the canvas keeps a stale bundle.
    const { bundler } = setup(LINKED);
    await bundler.build("default", [key("./src/components", "StatCard")]);
    await bundler.build("default", [key("./src/components/hero", "default")]);
    expect(bundler.size).toBe(2);
    bundler.invalidate([join(LINKED, "src", "components", "hero.tsx")]);
    expect(bundler.size).toBe(1);
    // A deleted file still has the canonical spelling of where it was.
    expect(pathKey(join(LINKED, "src", "gone", "missing.tsx"))).toBe(
      pathKey(join(FIXTURE, "src", "gone", "missing.tsx")),
    );
  }, 60_000);

  test("runtime reports from a mounted frame refine the build's verdict", () => {
    const { bundler } = setup();
    const k = key("./src/components/theme", "ThemedButton");
    bundler.recordRuntime(`/api/canvas/bundle.js?v=1&refs=${encodeURIComponent(k)}`, [
      { id: k, status: "unavailable", code: "missing-provider", note: "needs a ThemeProvider" },
      { id: 42 },
      "junk",
    ]);
    expect(bundler.runtimeDiagnostics([k])).toEqual([
      { id: k, status: "unavailable", code: "missing-provider", note: "needs a ThemeProvider" },
    ]);
  });

  test("a screen's findings answer for its components, not just for that screen", () => {
    const { bundler } = setup();
    const themed = key("./src/components/theme", "ThemedButton");
    const card = key("./src/components", "StatCard");
    // One frame mounts a whole screen…
    bundler.recordRuntime(
      `/api/canvas/bundle.js?v=1&refs=${encodeURIComponent(`${themed},${card}`)}`,
      [
        { id: themed, status: "unavailable", code: "missing-provider" },
        { id: card, status: "exact" },
      ],
    );
    // …and the Library, which asks about one component, still learns from it.
    expect(bundler.runtimeForComponents([themed])).toEqual([
      { id: themed, status: "unavailable", code: "missing-provider" },
    ]);
    expect(bundler.runtimeDiagnostics([themed])).toBeUndefined();
    expect(bundler.runtimeForComponents(["repo::./nowhere#Nothing"])).toEqual([]);

    // A later mount is the current truth: a fixed component stops being broken.
    bundler.recordRuntime(`/api/canvas/bundle.js?v=2&refs=${encodeURIComponent(themed)}`, [
      { id: themed, status: "exact" },
    ]);
    expect(bundler.runtimeForComponents([themed])).toEqual([{ id: themed, status: "exact" }]);

    // An edit makes every runtime verdict stale, including these.
    bundler.invalidate();
    expect(bundler.runtimeForComponents([themed])).toEqual([]);
  });
});
