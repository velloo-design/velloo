import { afterAll, afterEach, beforeAll, expect, spyOn, test } from "bun:test";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { repoKey } from "@velloo/schema";
import { buildCanvasBundle, type RepoBundleInput } from "../live/canvas-bundle.ts";

/**
 * A host root reached through a symlink (macOS's `/var` → `/private/var`, a
 * symlinked checkout) sometimes comes back from `Bun.resolveSync` in its
 * symlinked spelling, and then the bundler can keep that spelling too, while
 * the preview entry's own relative import of the same file resolves
 * canonically. The file is bundled twice, two `createContext` calls apart, and
 * the preview's provider no longer reaches the component it wraps — an
 * intermittent "must be used within a ThemeProvider". The spy pins Bun to the
 * symlinked answer; Bun.build canonicalizes on its own except in that same
 * state, so the contract is read off the entry it was handed.
 */

let root: string;
let real: string;
let link: string;
let folder: string;
let spy: ReturnType<typeof spyOn> | undefined;

beforeAll(async () => {
  root = realpathSync.native(await mkdtemp(join(tmpdir(), "velloo-canonical-")));
  real = join(root, "real-app");
  link = join(root, "app");
  folder = join(root, "design");
  await mkdir(join(real, "src", "components"), { recursive: true });
  await mkdir(join(real, "node_modules"), { recursive: true });
  const reactHost = resolve(import.meta.dir, "../../../renderer");
  for (const name of ["react", "react-dom"]) {
    const pkg = dirname(Bun.resolveSync(`${name}/package.json`, reactHost));
    await symlink(pkg, join(real, "node_modules", name), "dir");
  }
  await writeFile(
    join(real, "src", "components", "theme.tsx"),
    [
      'import { createContext, useContext } from "react";',
      "const Accent = createContext<string | null>(null);",
      "export function ThemeProvider({ children }: { children?: React.ReactNode }) {",
      '  return <Accent.Provider value="violet">{children}</Accent.Provider>;',
      "}",
      "export function ThemedButton() {",
      '  return <button type="button">{useContext(Accent)}</button>;',
      "}",
    ].join("\n"),
  );
  await symlink(real, link, "dir");
  await mkdir(folder, { recursive: true });
  await writeFile(
    join(folder, "preview.jsx"),
    [
      'import { ThemeProvider } from "../app/src/components/theme";',
      "export default function Preview({ children }) {",
      "  return <ThemeProvider>{children}</ThemeProvider>;",
      "}",
    ].join("\n"),
  );
});

afterEach(() => spy?.mockRestore());

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

test("the canvas entry names every module by its canonical path", async () => {
  const resolveSync = Bun.resolveSync;
  spy = spyOn(Bun, "resolveSync").mockImplementation((specifier: string, from: string) =>
    resolveSync(specifier, from).replace(real, link),
  );
  const key = repoKey({ importPath: "./src/components/theme", exportName: "ThemedButton" });
  const repo: RepoBundleInput = {
    host: () => ({ hostRoot: link, aliases: [] }),
    preview: () => ({ kind: "file", path: join(folder, "preview.jsx"), label: "preview.jsx" }),
    recipes: () => [],
    primaryApp: undefined,
  };
  const result = await buildCanvasBundle(
    link,
    { components: async () => [], styleRuntime: { kind: "none" } },
    [key],
    [],
    false,
    repo,
  );
  expect(result.usable).toBe(true);
  const entry = (result.inputs ?? []).find((input) => input.endsWith("/entry.tsx"));
  if (!entry) throw new Error("the build reported no entry");
  const source = await Bun.file(entry).text();
  // The entry spells each module as a JS string literal, so a Windows path's
  // backslashes appear doubled.
  const literal = (path: string) => JSON.stringify(path).slice(1, -1);
  expect(source).toContain(literal(join(real, "src", "components", "theme.tsx")));
  expect(source).not.toContain(literal(`${link}${sep}`));
}, 30_000);
