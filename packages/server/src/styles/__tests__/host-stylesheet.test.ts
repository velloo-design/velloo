import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "@velloo/schema";
import { repoKey } from "@velloo/schema";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import { CanvasBundler } from "../../live/canvas-bundler.ts";
import { fixtureApp } from "../../repo/__tests__/fixture-app.ts";
import { RepoComponents } from "../../repo/catalog.ts";
import { unprocessedStylesheets } from "../../repo/preview-styles.ts";
import { validateClassNames } from "../class-validation.ts";
import { compileHostStylesheet, needsTailwind, tailwindConfigFor } from "../host-stylesheet.ts";
import { TailwindJit } from "../tailwind-jit.ts";

/** A Tailwind v3 app's globals: the shape of a Next + shadcn app before v4. */
const V3_GLOBALS = `@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root { --ink: 220 18% 11%; }
  h1 { @apply uppercase; letter-spacing: -0.02em; }
}

@layer components {
  .label { @apply font-mono uppercase tracking-machine; }
  .rule { @apply border-t-2; }
}
`;

const V3_CONFIG = `export default {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: { extend: { letterSpacing: { machine: "0.22em" } } },
};
`;

let tmp: string;
beforeAll(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), "velloo-host-css-")));
  await mkdir(join(tmp, "v3", "app"), { recursive: true });
  await writeFile(join(tmp, "v3", "package.json"), '{"type":"module"}');
  await writeFile(join(tmp, "v3", "tailwind.config.js"), V3_CONFIG);
  await writeFile(join(tmp, "v3", "app", "globals.css"), V3_GLOBALS);
});
afterAll(() => rm(tmp, { recursive: true, force: true }));

describe("host stylesheet expansion", () => {
  test("only sheets with Tailwind syntax need it", () => {
    expect(needsTailwind(V3_GLOBALS)).toBe(true);
    expect(needsTailwind('@import "tailwindcss";\n')).toBe(true);
    expect(needsTailwind(":root { --a: 1px; }\n.card { padding: 4px; }")).toBe(false);
  });

  test("a v3 sheet's @apply resolves against the app's tailwind.config", async () => {
    const path = join(tmp, "v3", "app", "globals.css");
    expect(tailwindConfigFor(path)).toBe(join(tmp, "v3", "tailwind.config.js"));
    const result = await compileHostStylesheet(path, V3_GLOBALS);
    if (!result.ok) throw new Error(result.error);
    const label = result.css.match(/\.label \{[^}]*\}/)?.[0] ?? "";
    expect(label).toContain("letter-spacing: 0.22em");
    expect(label).toContain("text-transform: uppercase");
    expect(label).toContain("font-family");
    expect(result.css.match(/h1 \{[^}]*\}/)?.[0]).toContain("text-transform: uppercase");
    expect(result.css).toContain("--ink: 220 18% 11%");
    // Velloo's JIT owns preflight, utilities and the theme variables.
    expect(result.css).not.toContain("box-sizing: border-box");
    expect(result.css).not.toContain("--color-");
    expect(result.css).not.toContain(".uppercase");
  });

  test("a v4 sheet keeps its theme, custom variants and own utilities", async () => {
    const css = `@import "tailwindcss";
@custom-variant dark (&:where(.dark, .dark *));
@theme { --color-brand: #ff0000; }
@utility tab-4 { tab-size: 4; }
.btn { @apply bg-brand px-4 dark:uppercase; }
`;
    const result = await compileHostStylesheet(join(tmp, "v4.css"), css);
    if (!result.ok) throw new Error(result.error);
    expect(result.css).toContain("--color-brand: #ff0000");
    expect(result.css).toContain("background-color: var(--color-brand)");
    expect(result.css).toContain("&:where(.dark, .dark *)");
    expect(result.css).toContain(".tab-4");
  });

  test("a sheet Velloo's Tailwind can't expand is named, not silently dropped", async () => {
    const path = join(tmp, "broken.css");
    await writeFile(path, ".x { @apply not-a-utility; }\n");
    const [problem] = await unprocessedStylesheets([path, join(tmp, "v3", "app", "globals.css")]);
    expect(problem?.path).toBe(path);
    expect(problem?.error).toContain("not-a-utility");
  });

  test("the canvas bundle mounts the expanded sheet, not the raw one", async () => {
    const app = await fixtureApp();
    try {
      const root = await realpath(app.root);
      await writeFile(join(root, "tailwind.config.js"), V3_CONFIG);
      await writeFile(join(root, "src", "styles.css"), V3_GLOBALS);
      const repo = new RepoComponents({
        folderRoot: join(root, "velloo"),
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
      const result = await bundler.build("default", [
        repoKey({ importPath: "./src/components", exportName: "StatCard" }),
      ]);
      expect(result.usable).toBe(true);
      // Bun's CSS printer shortens `0.22em`.
      expect(result.code).toMatch(/\.label \{[^}]*letter-spacing: 0?\.22em/);
      expect(result.code).toMatch(/\.label \{[^}]*text-transform: uppercase/);
      expect(result.code).not.toContain("@apply");
    } finally {
      await app.cleanup();
    }
  }, 60_000);
});

describe("the host config's extended utilities", () => {
  test("compile and validate, so `tracking-machine` is not an invalid class", async () => {
    const folder = join(tmp, "v3", "velloo");
    await mkdir(join(folder, "screens"), { recursive: true });
    const jit = new TailwindJit(
      createShadcnProvider(),
      join(folder, "screens"),
      join(folder, "snippets"),
      undefined,
      undefined,
      () => join(tmp, "v3", "tailwind.config.js"),
    );
    expect(await jit.build(["tracking-machine"])).toContain("letter-spacing: 0.22em");
    const [report] = await validateClassNames(jit, "", ["tracking-machine"]);
    expect(report).toMatchObject({ class: "tracking-machine", valid: true });
  });
});
