import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { CANVAS_SOURCE_PACKAGES } from "../canvas-source-packages.ts";

/**
 * The canvas bundle compiles the helpers' browser source straight from the
 * shipped `dist/pkgs/helpers`, where no node_modules holds velloo's own
 * dependencies unless the published package declares them. From the monorepo
 * every import resolves, so a missing declaration only shows in the built
 * binary: an MUI screen with an `Icon` failed on `tailwind-merge` in every
 * eval run. Walk what the browser entry actually reaches and hold each bare
 * import to the list the build declares.
 */

const helpersSrc = resolve(import.meta.dir, "../../../helpers/src");
/** Resolved by the canvas bundle itself: React from the host app, velloo leaves from shipped source. */
const RESOLVED_ELSEWHERE = /^(?:react|react-dom)(?:\/|$)|^@velloo\//;

function bareImportsReachableFrom(entry: string): Set<string> {
  const bare = new Set<string>();
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const loader = extname(file) === ".tsx" ? "tsx" : "ts";
    const { imports } = new Bun.Transpiler({ loader }).scan(readFileSync(file, "utf8"));
    for (const { path, kind } of imports) {
      if (kind === "dynamic-import") continue;
      if (path.startsWith(".")) visit(resolve(dirname(file), path));
      else bare.add(path);
    }
  };
  visit(entry);
  return bare;
}

describe("canvas source packages", () => {
  test("every bare import the helpers' browser source reaches ships as a velloo dependency", () => {
    const needed = [...bareImportsReachableFrom(join(helpersSrc, "index.ts"))]
      .filter((specifier) => !RESOLVED_ELSEWHERE.test(specifier))
      .map((specifier) => specifier.split("/")[0] ?? specifier)
      .sort();
    expect(needed.length).toBeGreaterThan(0);
    expect([...new Set(needed)]).toEqual([...CANVAS_SOURCE_PACKAGES].sort());
  });

  test("the declared packages are the helpers' own pinned dependencies", () => {
    const helpers = JSON.parse(readFileSync(join(helpersSrc, "..", "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    for (const pkg of CANVAS_SOURCE_PACKAGES) expect(helpers.dependencies[pkg]).toBeDefined();
  });
});
