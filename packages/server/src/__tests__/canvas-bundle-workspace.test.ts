import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { aliasPairs } from "../live/bundle-core.ts";
import { buildCanvasBundle, type CanvasBundleSpec } from "../live/canvas-bundle.ts";

/**
 * A design recorded from a monorepo's root — `hostApp.root: ".."`, the
 * components under `web/src/components` — where the install does not hoist:
 * React is in `web/node_modules` and nowhere at the root. The mount resolved
 * its React from the root only, found none, and the whole screen fell back to
 * Velloo's bundled components while every file it would have mounted imports
 * the React beside it.
 */

let repo: string;
let web: string;

async function react(into: string): Promise<void> {
  const from = resolve(import.meta.dir, "../../../renderer");
  await mkdir(join(into, "node_modules"), { recursive: true });
  for (const name of ["react", "react-dom"]) {
    const pkg = dirname(Bun.resolveSync(`${name}/package.json`, from));
    await symlink(pkg, join(into, "node_modules", name), "dir");
  }
}

const cardSpec = (file: string): CanvasBundleSpec => ({
  components: (ids) =>
    ids.map((id) => ({
      id,
      sources: [{ importPath: file, exportName: id, fidelity: "exact", preflight: true }],
    })),
  styleRuntime: { kind: "none" },
});

beforeAll(async () => {
  repo = realpathSync.native(await mkdtemp(join(tmpdir(), "velloo-workspace-")));
  web = join(repo, "web");
  await mkdir(join(web, "src", "components", "ui"), { recursive: true });
  await mkdir(join(web, "src", "lib"), { recursive: true });
  // The root installs its own things; none of them is React.
  await mkdir(join(repo, "node_modules", "hono"), { recursive: true });
  await writeFile(
    join(repo, "package.json"),
    JSON.stringify({ name: "repo", workspaces: ["web"] }),
  );
  await writeFile(
    join(web, "package.json"),
    JSON.stringify({ name: "web", dependencies: { react: "*", "react-dom": "*" } }),
  );
  await react(web);
  await writeFile(
    join(web, "src", "lib", "utils.ts"),
    'export const cn = (...parts: string[]) => parts.join(" ");\n',
  );
  await writeFile(
    join(web, "src", "components", "ui", "card.tsx"),
    [
      'import * as React from "react";',
      'import { cn } from "@/lib/utils";',
      'export function Card({ className = "", ...props }: React.ComponentProps<"div">) {',
      '  return <div data-slot="card" className={cn("rounded-xl border", className)} {...props} />;',
      "}",
    ].join("\n"),
  );
});

afterAll(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe("buildCanvasBundle from a workspace root that has no React of its own", () => {
  test("mounts the app's component with the React its workspace installs", async () => {
    const aliases = aliasPairs({ root: "..", aliases: { "@/*": "web/src/*" } }, repo);
    const result = await buildCanvasBundle(
      repo,
      cardSpec(join(web, "src", "components", "ui", "card.tsx")),
      ["Card"],
      aliases,
    );
    expect(result.errors).toEqual([]);
    expect(result.diagnostics).toEqual([expect.objectContaining({ id: "Card", status: "exact" })]);
    expect(result.usable).toBe(true);
    // One React: the entry's and the component's are the workspace's copy.
    const reacts = new Set(
      (result.inputs ?? [])
        .filter((input) => /[\\/]react[\\/]index\.js$/.test(input))
        .map((input) => realpathSync.native(input)),
    );
    expect([...reacts]).toEqual([
      realpathSync.native(join(web, "node_modules", "react", "index.js")),
    ]);
  }, 30_000);

  test("says what to do when two workspaces have a React each", async () => {
    const split = join(repo, "split");
    await mkdir(join(split, "node_modules"), { recursive: true });
    await writeFile(
      join(split, "package.json"),
      JSON.stringify({ name: "split", workspaces: ["web", "admin"] }),
    );
    for (const [name, version] of [
      ["web", "19.0.0"],
      ["admin", "18.3.1"],
    ] as const) {
      for (const pkg of ["react", "react-dom"]) {
        const dir = join(split, name, "node_modules", pkg);
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, "package.json"), JSON.stringify({ name: pkg, version }));
        await writeFile(join(dir, "index.js"), "export {};\n");
        await writeFile(join(dir, "client.js"), "export {};\n");
      }
      await writeFile(join(split, name, "package.json"), JSON.stringify({ name }));
    }
    const result = await buildCanvasBundle(split, cardSpec(join(split, "web", "card.tsx")), [
      "Card",
    ]);
    expect(result.usable).toBe(false);
    const messages = result.errors.map((error) => error.message).join("\n");
    expect(messages).toContain("Its workspaces admin, web each have their own copy.");
    expect(messages).toContain(`No React resolves from the application root ${split}`);
    expect(messages).toContain("velloo design set-app-root");
  }, 30_000);
});
