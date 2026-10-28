import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { aliasPairs, tsconfigAliases } from "../live/bundle-core.ts";

/**
 * An app's import aliases are read from its own tsconfig, so its components
 * resolve on the canvas. A Vite app keeps them in `tsconfig.app.json`, behind
 * the `references` of a `tsconfig.json` that declares none — and reading only
 * that file left every `@/` import unresolved, so nothing of the app mounted.
 */

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "velloo-tsconfig-"));
});
afterEach(() => rm(root, { recursive: true, force: true }));

async function write(files: Record<string, unknown>): Promise<void> {
  for (const [rel, body] of Object.entries(files)) {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await writeFile(join(root, rel), typeof body === "string" ? body : JSON.stringify(body));
  }
}

describe("tsconfigAliases", () => {
  test("follows a solution tsconfig's references to the project that declares them", async () => {
    await write({
      "tsconfig.json": `{
        // Vite's solution file
        "files": [],
        "references": [{ "path": "./tsconfig.app.json" }, { "path": "./tsconfig.node.json" }],
      }`,
      "tsconfig.app.json": { compilerOptions: { paths: { "@/*": ["./src/*"] } } },
      "tsconfig.node.json": { compilerOptions: {} },
    });
    expect(tsconfigAliases(root)).toEqual([{ from: "@/", to: "src/" }]);
  });

  test("a reference to a directory reads its tsconfig.json", async () => {
    await write({
      "tsconfig.json": { files: [], references: [{ path: "./web" }] },
      "web/tsconfig.json": { compilerOptions: { paths: { "@/*": ["./src/*"] } } },
    });
    expect(tsconfigAliases(root)).toEqual([{ from: "@/", to: "web/src/" }]);
  });

  test("paths inherited through extends resolve against the config that declares them", async () => {
    await write({
      "tsconfig.json": { extends: "./config/tsconfig.base.json", compilerOptions: {} },
      "config/tsconfig.base.json": { compilerOptions: { paths: { "~/*": ["../app/*"] } } },
    });
    expect(tsconfigAliases(root)).toEqual([{ from: "~/", to: "app/" }]);
  });

  test("baseUrl is where paths resolve from, wherever in the chain it is set", async () => {
    await write({
      "tsconfig.json": {
        extends: "./tsconfig.base",
        compilerOptions: { paths: { "@/*": ["*"], "@ui": ["components/ui/index.ts"] } },
      },
      "tsconfig.base.json": { compilerOptions: { baseUrl: "./src" } },
    });
    expect(tsconfigAliases(root)).toEqual([
      { from: "@/", to: "src/" },
      { from: "@ui", to: "src/components/ui/index.ts" },
    ]);
  });

  test("an alias to the app root itself is the empty prefix", async () => {
    await write({ "jsconfig.json": { compilerOptions: { paths: { "@/*": ["./*"] } } } });
    expect(tsconfigAliases(root)).toEqual([{ from: "@/", to: "" }]);
  });

  test("the app's own paths are added to the alias init recorded", async () => {
    await write({
      "tsconfig.json": { files: [], references: [{ path: "./tsconfig.app.json" }] },
      "tsconfig.app.json": { compilerOptions: { paths: { "@/*": ["./src/*"] } } },
      "app/.keep": "",
    });
    expect(aliasPairs({ root: ".", aliases: { "~/*": "app/*" } }, root)).toEqual([
      { from: "~/", to: "app/" },
      { from: "@/", to: "src/" },
    ]);
  });
});
