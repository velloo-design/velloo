import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Extension, HostApp } from "@velloo/schema";
import { LiveBundler, liveExtensions } from "../component-bundler.ts";

/**
 * Real `Bun.build` against a simulated host app (no fs mocks, per repo
 * convention). The host is a tmp dir whose node_modules symlinks the
 * repo's react / react-dom so the bundler resolves them the way a flat
 * host app would. We assert the build succeeds and the component content
 * lands in the bundle — runtime single-React correctness is covered by
 * the in-browser client-mount path, not here.
 */

const repoRoot = resolve(import.meta.dir, "../../../../..");
const rendererDir = join(repoRoot, "packages/renderer");
const reactPkg = dirname(Bun.resolveSync("react", rendererDir));
const reactDomPkg = dirname(Bun.resolveSync("react-dom/client", rendererDir));

let tmp: string;
let hostRoot: string;

beforeEach(async () => {
  tmp = join(
    tmpdir(),
    `velloo-live-test-${Bun.hash(`${import.meta.dir}${Math.random()}`).toString(16)}`,
  );
  hostRoot = join(tmp, "app");
  await mkdir(join(hostRoot, "node_modules"), { recursive: true });
  await mkdir(join(hostRoot, "src", "charts"), { recursive: true });
  await symlink(reactPkg, join(hostRoot, "node_modules", "react"), "dir");
  await symlink(reactDomPkg, join(hostRoot, "node_modules", "react-dom"), "dir");
  await writeFile(
    join(hostRoot, "src", "charts", "PriceChart.tsx"),
    `import * as React from "react";
export function PriceChart() {
  return React.createElement("div", { className: "price-chart-marker" }, "chart");
}
`,
    "utf8",
  );
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

function liveExt(importPath: string): Extension {
  return { importPath, props: [], render: "live" };
}

function makeBundler(
  extensions: Record<string, Extension>,
  hostApp: HostApp | undefined = { root: hostRoot, aliases: { "@/*": "src/*" } },
): LiveBundler {
  return new LiveBundler(
    join(tmp, "velloo"),
    () => hostApp,
    () => liveExtensions(extensions),
  );
}

describe("liveExtensions", () => {
  test("keeps only render:live entries", () => {
    const filtered = liveExtensions({
      A: liveExt("@/a"),
      B: { importPath: "@/b", props: [] },
      C: { importPath: "@/c", props: [], render: "static" },
    });
    expect(Object.keys(filtered)).toEqual(["A"]);
  });
});

describe("LiveBundler", () => {
  test("no live extensions → empty module, no errors", async () => {
    const result = await makeBundler({}).build();
    expect(result.errors).toEqual([]);
    expect(result.code).toContain("components");
  });

  test("host without react → clear React 18+ error", async () => {
    const noReactHost = join(tmp, "no-react");
    await mkdir(noReactHost, { recursive: true });
    const result = await makeBundler(
      { Chart: liveExt("@/charts/PriceChart") },
      {
        root: noReactHost,
      },
    ).build();
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]?.message).toContain("React 18");
  });

  test("unresolvable importPath → structured error + valid fallback module", async () => {
    const result = await makeBundler({ Missing: liveExt("@/does/not/exist") }).build();
    expect(result.errors.some((e) => e.importPath === "@/does/not/exist")).toBe(true);
    // No component resolved, so the served module is the empty fallback.
    expect(result.code).toContain("components = {}");
  });

  test("resolves a host component and bundles its content", async () => {
    const result = await makeBundler({ PriceChart: liveExt("@/charts/PriceChart") }).build();
    expect(result.errors).toEqual([]);
    expect(result.code).toContain("price-chart-marker");
    expect(result.code).toContain("ErrorBoundary");
  });

  test("hostSourceDirs returns in-tree component dirs, excludes node_modules", () => {
    const bundler = makeBundler({
      PriceChart: liveExt("@/charts/PriceChart"),
      FromPkg: liveExt("react"),
    });
    const dirs = bundler.hostSourceDirs();
    expect(dirs.some((d) => d.endsWith(join("src", "charts")))).toBe(true);
    expect(dirs.some((d) => d.includes("node_modules"))).toBe(false);
  });

  test("caches the build and rebuilds on invalidate (version bumps)", async () => {
    const bundler = makeBundler({ PriceChart: liveExt("@/charts/PriceChart") });
    expect(bundler.version).toBe(0);
    const first = await bundler.build();
    const second = await bundler.build();
    expect(second).toBe(first); // cache hit returns the same object
    bundler.invalidate();
    expect(bundler.version).toBe(1);
    const third = await bundler.build();
    expect(third).not.toBe(first); // rebuilt
    expect(third.code).toContain("price-chart-marker");
  });
});
