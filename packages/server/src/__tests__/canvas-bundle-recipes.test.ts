import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { repoKey } from "@velloo/schema";
import { buildCanvasBundle, type RepoBundleInput } from "../live/canvas-bundle.ts";
import { mantineRecipe } from "../repo/recipes/mantine.ts";

/**
 * A recipe speaks for a component because the app it comes from has the
 * library installed. In a monorepo where only a secondary app depends on
 * Mantine, asking the screen's primary app instead found no recipe, and that
 * app's `Menu` mounted with its portal — escaping the frame — instead of inline.
 */

let root: string;
let web: string;
let admin: string;

async function hostApp(dir: string): Promise<void> {
  await mkdir(join(dir, "node_modules"), { recursive: true });
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: basename(dir) }));
  // One React for both apps, as a hoisted monorepo has; borrowed from provider-mui.
  const reactHost = resolve(import.meta.dir, "../../../provider-mui");
  for (const name of ["react", "react-dom"]) {
    const pkg = dirname(Bun.resolveSync(`${name}/package.json`, reactHost));
    await symlink(pkg, join(dir, "node_modules", name), "dir");
  }
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "velloo-recipe-apps-"));
  web = join(root, "web");
  admin = join(root, "admin");
  await hostApp(web);
  await hostApp(admin);
  const mantine = join(admin, "node_modules", "@mantine", "core");
  await mkdir(mantine, { recursive: true });
  await writeFile(
    join(mantine, "package.json"),
    JSON.stringify({ name: "@mantine/core", version: "7.0.0", main: "index.js" }),
  );
  await writeFile(join(mantine, "index.js"), "export function Menu() { return null; }\n");
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

test("a secondary app's component keeps its own app's recipe adaptation", async () => {
  const key = repoKey({ app: "admin", importPath: "@mantine/core", exportName: "Menu" });
  const repo: RepoBundleInput = {
    host: (app) => ({ hostRoot: app === "admin" ? admin : web, aliases: [] }),
    preview: () => ({ kind: "none", label: "none" }),
    recipes: (app) => (app === "admin" ? [mantineRecipe] : []),
    primaryApp: undefined,
  };
  const result = await buildCanvasBundle(
    web,
    { components: async () => [], styleRuntime: { kind: "none" } },
    [key],
    [],
    false,
    repo,
  );
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ id: key, app: "admin", status: "adapted" }),
  );
}, 30_000);
