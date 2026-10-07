import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { cp, mkdir, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Config } from "@velloo/schema";
import { repoKey } from "@velloo/schema";
import { fixtureApp } from "../../repo/__tests__/fixture-app.ts";
import { RepoComponents } from "../../repo/catalog.ts";
import { CanvasBundler } from "../canvas-bundler.ts";

/**
 * An icon package's barrel re-exports thousands of icons. A screen that uses
 * one must ship one: @mui/icons-material went 8.7 MB over a single icon and
 * past the canvas budget, so agents stripped icons out of their designs.
 */

const ICONS = 400;
let app: Awaited<ReturnType<typeof fixtureApp>>;
let root: string;

beforeEach(async () => {
  app = await fixtureApp();
  root = realpathSync(app.root);
  const pkg = join(root, "node_modules", "fake-icons");
  await mkdir(join(pkg, "esm"), { recursive: true });
  await writeFile(
    join(pkg, "package.json"),
    JSON.stringify({
      name: "fake-icons",
      version: "1.0.0",
      type: "module",
      sideEffects: false,
      exports: { ".": "./esm/index.js" },
    }),
  );
  const index: string[] = [];
  for (let n = 0; n < ICONS; n++) {
    await writeFile(
      join(pkg, "esm", `Icon${n}.js`),
      // Built by a call at the top of the module, as real icon packages do
      // (`createLucideIcon(…)`): only `sideEffects: false` lets a bundler drop it.
      `import { make } from "./make.js";
const Icon${n} = make("ICON_BODY_${n}_${"x".repeat(200)}");
export { Icon${n} as default };
`,
    );
    index.push(`export { default as Icon${n} } from "./Icon${n}.js";`);
  }
  await writeFile(join(pkg, "esm", "index.js"), `${index.join("\n")}\n`);
  await writeFile(
    join(pkg, "esm", "make.js"),
    `import * as React from "react";
export function make(body) { return function Icon() { return React.createElement("svg", { "data-body": body }); }; }
`,
  );

  // The same icons as a package that predates `exports`: a CommonJS `main`
  // holding every icon in one file, and the ES barrel under `module`. The
  // shape of @tabler/icons-react and lucide-react.
  const legacy = join(root, "node_modules", "legacy-icons");
  await mkdir(join(legacy, "cjs"), { recursive: true });
  await writeFile(
    join(legacy, "package.json"),
    JSON.stringify({
      name: "legacy-icons",
      version: "1.0.0",
      main: "./cjs/index.cjs",
      module: "./esm/index.mjs",
      sideEffects: false,
    }),
  );
  const cjs = [`const React = require("react");`];
  for (let n = 0; n < ICONS; n++) {
    cjs.push(
      `exports.Icon${n} = function Icon${n}() { return React.createElement("svg", { "data-body": "ICON_BODY_${n}_${"x".repeat(200)}" }); };`,
    );
  }
  await writeFile(join(legacy, "cjs", "index.cjs"), `${cjs.join("\n")}\n`);
  await cp(join(pkg, "esm"), join(legacy, "esm"), { recursive: true });
  await rename(join(legacy, "esm", "index.js"), join(legacy, "esm", "index.mjs"));
  await writeFile(join(legacy, "esm", "package.json"), JSON.stringify({ type: "module" }));

  // And as `lucide-react` itself, which the bundle resolves from the host by
  // name for whichever file imports it — here one of the app's own components.
  const lucide = join(root, "node_modules", "lucide-react");
  await cp(legacy, lucide, { recursive: true });
  await writeFile(
    join(lucide, "package.json"),
    JSON.stringify({
      name: "lucide-react",
      version: "1.0.0",
      main: "./cjs/index.cjs",
      module: "./esm/index.mjs",
      sideEffects: false,
    }),
  );
  await writeFile(
    join(root, "src", "starred.tsx"),
    `import { Icon7 } from "lucide-react";
export function Starred() { return <span><Icon7 /></span>; }
`,
  );
});

afterEach(() => app.cleanup());

const bundler = () =>
  new CanvasBundler(
    root,
    () => ({ root }),
    () => undefined,
    false,
    {
      repo: new RepoComponents({
        folderRoot: resolve(root, "velloo"),
        config: () => ({ hostApp: { root } }) as unknown as Config,
        reservedIds: () => new Set(),
      }),
    },
  );

describe("repository components from a barrel", () => {
  test("ship only the icons the screen uses", async () => {
    const seven = repoKey({ importPath: "fake-icons", exportName: "Icon7" });
    const nine = repoKey({ importPath: "fake-icons", exportName: "Icon9" });
    const result = await bundler().build("default", [seven, nine]);
    expect(result.errors).toEqual([]);
    const status = Object.fromEntries(result.diagnostics.map((d) => [d.id, d.status]));
    expect(status[seven]).toBe("exact");
    expect(result.code.includes("ICON_BODY_7_")).toBe(true);
    expect(result.code.includes("ICON_BODY_9_")).toBe(true);
    expect(result.code.includes("ICON_BODY_8_")).toBe(false);
    // Two icons of 400 — a namespace import would carry every body.
    expect(result.code.split("ICON_BODY_").length - 1).toBe(2);
  }, 60_000);

  test("a package with a CommonJS `main` and an ES `module` ships from the ES one", async () => {
    const seven = repoKey({ importPath: "legacy-icons", exportName: "Icon7" });
    const nine = repoKey({ importPath: "legacy-icons", exportName: "Icon9" });
    const result = await bundler().build("default", [seven, nine]);
    expect(result.errors).toEqual([]);
    expect(result.diagnostics.map((d) => d.status)).toEqual(["exact", "exact"]);
    // `main` is one file with all 400; resolving to it shipped every body.
    expect(result.code.split("ICON_BODY_").length - 1).toBe(2);
    expect(result.code).not.toContain("cjs/index.cjs");
  }, 60_000);

  test("an app component importing one icon by package name ships one icon", async () => {
    const starred = repoKey({ importPath: "./src/starred", exportName: "Starred" });
    const result = await bundler().build("default", [starred]);
    expect(result.errors).toEqual([]);
    expect(result.diagnostics.map((d) => d.status)).toEqual(["exact"]);
    expect(result.code.includes("ICON_BODY_7_")).toBe(true);
    expect(result.code.split("ICON_BODY_").length - 1).toBe(1);
  }, 60_000);

  test("a name the barrel doesn't declare keeps the namespace import, and the bundle still builds", async () => {
    const seven = repoKey({ importPath: "fake-icons", exportName: "Icon7" });
    const missing = repoKey({ importPath: "fake-icons", exportName: "NoSuchIcon" });
    const result = await bundler().build("default", [seven, missing]);
    expect(result.errors).toEqual([]);
    expect(result.code.includes("ICON_BODY_7_")).toBe(true);
  }, 60_000);
});
