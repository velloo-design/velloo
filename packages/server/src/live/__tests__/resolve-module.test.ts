import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { resolveModule } from "../bundle-core.ts";

/**
 * A path handed to the bundle has to be the file the bundler would have found.
 *
 * Velloo resolves a component's package itself and imports it by path, while
 * the app's own files import the same package by name and let `Bun.build`
 * resolve it. Where the two disagree the package is in the bundle twice — and
 * for a package that predates `exports` they did disagree: the runtime
 * resolver returns `main` (CommonJS, the whole package), the bundler `module`.
 * Each shape below is checked against a real build rather than against a
 * rule, so the day Bun changes its order this fails.
 */

const SHAPES: Record<string, Record<string, unknown>> = {
  "main-only": { main: "./cjs.cjs" },
  "main-module": { main: "./cjs.cjs", module: "./esm.mjs" },
  "main-module-browser": { main: "./cjs.cjs", module: "./esm.mjs", browser: "./browser.js" },
  "main-browser": { main: "./cjs.cjs", browser: "./browser.js" },
  "module-without-extension": { main: "./cjs.cjs", module: "esm" },
  "browser-map": {
    main: "./cjs.cjs",
    module: "./esm.mjs",
    browser: { "./unrelated.js": "./browser.js" },
  },
  "@scope/main-module": { main: "./cjs.cjs", module: "./esm.mjs" },
  "exports-import-require": {
    main: "./cjs.cjs",
    module: "./browser.js",
    exports: { ".": { import: "./esm.mjs", require: "./cjs.cjs" } },
  },
};

let root: string;
beforeAll(async () => {
  root = realpathSync.native(await mkdtemp(join(tmpdir(), "velloo-resolve-")));
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "app", private: true }));
  for (const [name, fields] of Object.entries(SHAPES)) {
    const dir = join(root, "node_modules", name);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name, version: "1.0.0", ...fields }),
    );
    await writeFile(join(dir, "cjs.cjs"), `exports.which = "cjs.cjs";\n`);
    await writeFile(join(dir, "esm.mjs"), `export const which = "esm.mjs";\n`);
    await writeFile(join(dir, "browser.js"), `export const which = "browser.js";\n`);
  }
  // A manifest inside a build directory is not the package's own.
  const nested = join(root, "node_modules", "nested-manifest");
  await mkdir(join(nested, "dist", "cjs"), { recursive: true });
  await mkdir(join(nested, "dist", "esm"), { recursive: true });
  await writeFile(
    join(nested, "package.json"),
    JSON.stringify({
      name: "nested-manifest",
      main: "./dist/cjs/index.js",
      module: "./dist/esm/index.js",
    }),
  );
  await writeFile(
    join(nested, "dist", "cjs", "package.json"),
    JSON.stringify({ type: "commonjs" }),
  );
  await writeFile(join(nested, "dist", "cjs", "index.js"), `exports.which = "cjs";\n`);
  await writeFile(join(nested, "dist", "esm", "package.json"), JSON.stringify({ type: "module" }));
  await writeFile(join(nested, "dist", "esm", "index.js"), `export const which = "esm";\n`);
});
afterAll(() => rm(root, { recursive: true, force: true }));

/** The file `Bun.build` bundles for a bare import of `name` from the app. */
async function bundled(name: string): Promise<string | undefined> {
  const entry = join(root, `${name.replace(/\W+/g, "-")}.entry.ts`);
  await writeFile(entry, `import { which } from ${JSON.stringify(name)};\nconsole.log(which);\n`);
  const built = await Bun.build({ entrypoints: [entry], target: "browser" });
  expect(built.success).toBe(true);
  return /which = "([\w.]+)"/.exec((await built.outputs[0]?.text()) ?? "")?.[1];
}

describe("resolveModule", () => {
  for (const name of Object.keys(SHAPES)) {
    test(`${name}: the file the browser bundler uses`, async () => {
      // Resolved first, as the daemon does before it builds. The order is part
      // of the answer: Bun's bundler stops applying a string `browser` field
      // to a package whose manifest the runtime resolver has already read.
      const ours = basename(resolveModule(name, root));
      expect(ours).toBe((await bundled(name)) ?? "");
    });
  }

  test("a package with only `main` still resolves to it", () => {
    expect(basename(resolveModule("main-only", root))).toBe("cjs.cjs");
  });

  test("the ES build is found past a build directory's own manifest", () => {
    expect(resolveModule("nested-manifest", root)).toBe(
      join(root, "node_modules", "nested-manifest", "dist", "esm", "index.js"),
    );
  });

  test("a path inside a package is the file it names", () => {
    expect(resolveModule("main-module/cjs.cjs", root)).toBe(
      join(root, "node_modules", "main-module", "cjs.cjs"),
    );
    expect(resolveModule("./node_modules/main-module/cjs.cjs", root)).toBe(
      join(root, "node_modules", "main-module", "cjs.cjs"),
    );
  });
});
