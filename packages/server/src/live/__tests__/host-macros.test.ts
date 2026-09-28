import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Config } from "@velloo/schema";
import { repoKey } from "@velloo/schema";
import { fixtureApp } from "../../repo/__tests__/fixture-app.ts";
import { RepoComponents } from "../../repo/catalog.ts";
import { buildHostSource } from "../bundle-core.ts";
import { CanvasBundler } from "../canvas-bundler.ts";
import { LiveBundler, liveExtensions } from "../component-bundler.ts";

/**
 * A cloned repo must not run code on the daemon just because its components
 * are bundled for the canvas: each fixture component calls a Bun macro that
 * writes a marker file, and every host-source build path has to refuse it.
 */

let app: Awaited<ReturnType<typeof fixtureApp>>;
let root: string;
let marker: string;

beforeEach(async () => {
  app = await fixtureApp();
  root = realpathSync(app.root);
  marker = join(root, "macro-ran");
  await mkdir(join(root, "src", "evil"), { recursive: true });
  await writeFile(
    join(root, "src", "evil", "macro.ts"),
    `import { writeFileSync } from "node:fs";
export function payload() {
  writeFileSync(${JSON.stringify(marker)}, "ran");
  return "payload";
}
`,
  );
  await writeFile(
    join(root, "src", "evil", "Evil.tsx"),
    `import * as React from "react";
import { payload } from "./macro.ts" with { type: "macro" };
export function Evil() {
  return React.createElement("div", null, payload());
}
`,
  );
});

afterEach(() => app.cleanup());

describe("host-source bundling never runs the repo's macros", () => {
  test("the fixture's macro does run under a plain Bun.build", async () => {
    await Bun.build({ entrypoints: [join(root, "src", "evil", "Evil.tsx")], target: "browser" });
    expect(existsSync(marker)).toBe(true);
  });

  test("buildHostSource rejects the macro import", async () => {
    const result = await buildHostSource({
      entrypoints: [join(root, "src", "evil", "Evil.tsx")],
      target: "browser",
      throw: false,
    });
    expect(result.success).toBe(false);
    expect(result.logs.map((log) => log.message).join("\n")).toContain("Macros are disabled");
    expect(existsSync(marker)).toBe(false);
  });

  test("a repository component with a macro falls back without running it", async () => {
    const repo = new RepoComponents({
      folderRoot: resolve(root, "velloo"),
      config: () => ({ hostApp: { root } }) as unknown as Config,
      reservedIds: () => new Set(),
    });
    const bundler = new CanvasBundler(
      root,
      () => ({ root }),
      () => undefined,
      false,
      { repo },
    );
    const evil = repoKey({ importPath: "./src/evil/Evil", exportName: "Evil" });
    const safe = repoKey({ importPath: "./src/components", exportName: "StatCard" });
    const result = await bundler.build("default", [evil, safe]);
    expect(existsSync(marker)).toBe(false);
    const status = Object.fromEntries(result.diagnostics.map((d) => [d.id, d.status]));
    expect(status[evil]).toBe("unavailable");
    expect(status[safe]).toBe("exact");
  }, 60_000);

  test("a live island with a macro does not run it", async () => {
    const bundler = new LiveBundler(
      join(root, "velloo"),
      () => ({ hostApp: { root } }),
      () => liveExtensions({ Evil: { importPath: "./src/evil/Evil", props: [], render: "live" } }),
    );
    const result = await bundler.build();
    expect(existsSync(marker)).toBe(false);
    expect(result.errors.map((error) => error.message).join("\n")).toContain("Macros are disabled");
  }, 60_000);
});
