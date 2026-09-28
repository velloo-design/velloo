import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
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
      `import * as React from "react";
export default function Icon${n}() { return React.createElement("svg", { "data-body": "ICON_BODY_${n}_${"x".repeat(200)}" }); }
`,
    );
    index.push(`export { default as Icon${n} } from "./Icon${n}.js";`);
  }
  await writeFile(join(pkg, "esm", "index.js"), `${index.join("\n")}\n`);
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

  test("a name the barrel doesn't declare keeps the namespace import, and the bundle still builds", async () => {
    const seven = repoKey({ importPath: "fake-icons", exportName: "Icon7" });
    const missing = repoKey({ importPath: "fake-icons", exportName: "NoSuchIcon" });
    const result = await bundler().build("default", [seven, missing]);
    expect(result.errors).toEqual([]);
    expect(result.code.includes("ICON_BODY_7_")).toBe(true);
  }, 60_000);
});
