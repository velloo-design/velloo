import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { parseThemeCss } from "@velloo/codegen";
import { expandStylesheetImports } from "../stylesheet-imports.ts";

/**
 * The stylesheet an app points at is often only an entry point. What has to
 * hold: the tokens in a sheet it imports by relative path are read, and
 * nothing outside the app — a package, a URL, a `../` or a symlink that leaves
 * the root — ever is.
 */

let app: string;
let outside: string;

async function sheet(rel: string, css: string, base = app): Promise<string> {
  const path = join(base, rel);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, css, "utf8");
  return path;
}

const expand = (entry: string) => expandStylesheetImports(entry, { root: app });

beforeEach(async () => {
  app = await mkdtemp(join(tmpdir(), "velloo-sheet-imports-"));
  outside = await mkdtemp(join(tmpdir(), "velloo-sheet-outside-"));
});

afterEach(async () => {
  await rm(app, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe("expandStylesheetImports", () => {
  test("reads the tokens of a sheet the entry imports by relative path", async () => {
    const theme = await sheet(
      "src/styles/theme.css",
      ":root { --primary: oklch(0.208 0.042 265.755); --radius: 0.625rem; }\n.dark { --primary: oklch(0.929 0.013 255.508); }\n",
    );
    const entry = await sheet(
      "src/styles/index.css",
      "@import 'tailwindcss';\n@import 'tw-animate-css';\n@import './theme.css';\n\n@custom-variant dark (&:is(.dark *));\n",
    );

    const expanded = expand(entry);
    expect(expanded.followed).toEqual([theme]);
    expect(expanded.skipped).toEqual([]);
    // The packages stay as written: nothing resolves them.
    expect(expanded.css).toContain("@import 'tailwindcss';");
    expect(expanded.css).not.toContain("./theme.css");

    const parsed = parseThemeCss(expanded.css);
    expect(JSON.stringify(parsed.colors.primary)).toContain("oklch(0.208 0.042 265.755)");
    expect(JSON.stringify(parsed.colorsDark.primary)).toContain("oklch(0.929 0.013 255.508)");
    expect(parsed.radius).toBe("0.625rem");
  });

  test("a sheet with no relative imports comes back as written", async () => {
    const css =
      '@import "tailwindcss";\n@import url("https://fonts.example.com/x.css");\n:root{--primary: red;}\n';
    const entry = await sheet("globals.css", css);
    expect(expand(entry)).toEqual({ css, followed: [], skipped: [] });
  });

  test("follows nested imports, the url() form, and a trailing layer()", async () => {
    await sheet("styles/palette.css", ":root { --brand: #123456; }");
    await sheet(
      "styles/tokens.css",
      '@import url("./palette.css") layer(tokens);\n:root { --primary: var(--brand); }',
    );
    const entry = await sheet("styles/index.css", '@import "./tokens.css" layer(base);');

    const expanded = expand(entry);
    expect(expanded.followed).toEqual([
      join(app, "styles/tokens.css"),
      join(app, "styles/palette.css"),
    ]);
    expect(expanded.css).toContain("--brand: #123456");
    expect(expanded.css).not.toContain("@import");
  });

  test("resolves each import against the sheet that names it", async () => {
    await sheet("src/tokens/colors.css", ":root { --primary: #0a0a0a; }");
    await sheet("src/tokens/index.css", '@import "./colors.css";');
    const entry = await sheet("src/app/globals.css", '@import "../tokens/index.css";');
    expect(expand(entry).css).toContain("--primary: #0a0a0a");
  });

  test("a bare file name is followed only when that file is beside the sheet", async () => {
    await sheet("theme.css", ":root { --primary: #111111; }");
    const entry = await sheet(
      "index.css",
      '@import "theme.css";\n@import "tailwindcss/theme.css";',
    );

    const expanded = expand(entry);
    expect(expanded.followed).toEqual([join(app, "theme.css")]);
    expect(expanded.css).toContain('@import "tailwindcss/theme.css";');
    // A package is not a relative import that went missing.
    expect(expanded.skipped).toEqual([]);
  });

  test("never reads through node_modules, even by relative path", async () => {
    await sheet("node_modules/acme/theme.css", ":root { --primary: #bad000; }");
    const entry = await sheet("src/index.css", '@import "../node_modules/acme/theme.css";');

    const expanded = expand(entry);
    expect(expanded.css).not.toContain("#bad000");
    expect(expanded.skipped[0]?.reason).toBe("outside the app root");
  });

  test("an import that climbs out of the app root is not read", async () => {
    await sheet("secret.css", ":root { --primary: #bad000; }", outside);
    const entry = await sheet("src/index.css", `@import "../../${basename(outside)}/secret.css";`);

    const expanded = expand(entry);
    expect(expanded.followed).toEqual([]);
    expect(expanded.css).not.toContain("#bad000");
    expect(expanded.skipped).toEqual([
      {
        specifier: `../../${basename(outside)}/secret.css`,
        from: entry,
        reason: "outside the app root",
      },
    ]);
  });

  test("a symlink inside the app that points outside it is not read", async () => {
    const secret = await sheet("secret.css", ":root { --primary: #bad000; }", outside);
    await mkdir(join(app, "src"), { recursive: true });
    await symlink(secret, join(app, "src", "theme.css"));
    const entry = await sheet("src/index.css", '@import "./theme.css";');

    const expanded = expand(entry);
    expect(expanded.css).not.toContain("#bad000");
    expect(expanded.skipped[0]?.reason).toBe("outside the app root");
  });

  test("a missing file and a non-CSS file are reported, not followed", async () => {
    await sheet("tokens.scss", "$primary: red;");
    const entry = await sheet(
      "index.css",
      '@import "./gone.css";\n@import "./tokens.scss";\n:root{--primary: red;}',
    );

    const expanded = expand(entry);
    expect(expanded.followed).toEqual([]);
    expect(expanded.skipped.map((s) => [s.specifier, s.reason])).toEqual([
      ["./gone.css", "no such file"],
      ["./tokens.scss", "not a .css file"],
    ]);
    expect(expanded.css).toContain("--primary: red");
  });

  test("an import cycle ends", async () => {
    await sheet("a.css", '@import "./b.css";\n:root { --primary: #aaaaaa; }');
    await sheet("b.css", '@import "./a.css";\n:root { --ring: #bbbbbb; }');

    const expanded = expand(join(app, "a.css"));
    expect(expanded.followed).toEqual([join(app, "b.css")]);
    expect(expanded.css).toContain("#aaaaaa");
    expect(expanded.css).toContain("#bbbbbb");
  });

  test("stops at a bounded depth and says so", async () => {
    for (let i = 0; i < 8; i++) {
      await sheet(`s${i}.css`, `@import "./s${i + 1}.css";\n:root { --level-${i}: #000000; }`);
    }
    await sheet("s8.css", ":root { --level-8: #000000; }");

    const expanded = expand(join(app, "s0.css"));
    expect(expanded.followed).toHaveLength(5);
    expect(expanded.css).toContain("--level-5");
    expect(expanded.css).not.toContain("--level-6");
    expect(expanded.skipped.map((s) => s.specifier)).toEqual(["./s6.css"]);
    expect(expanded.skipped[0]?.reason).toContain("deep");
  });

  test("an import inside a comment is not an import", async () => {
    await sheet("old.css", ":root { --primary: #bad000; }");
    const entry = await sheet(
      "index.css",
      '/* @import "./old.css"; */\n:root { --primary: #00aa00; }',
    );

    const expanded = expand(entry);
    expect(expanded.followed).toEqual([]);
    expect(expanded.css).not.toContain("#bad000");
  });

  test("a sheet imported for dark mode stays the dark palette", async () => {
    await sheet("dark.css", ":root { --background: oklch(0.145 0 0); }");
    const entry = await sheet(
      "index.css",
      '@import "./dark.css" (prefers-color-scheme: dark);\n:root { --background: oklch(1 0 0); }',
    );

    const parsed = parseThemeCss(expand(entry).css);
    expect(parsed.colors.background).toBe("oklch(1 0 0)");
    expect(parsed.colorsDark.background).toBe("oklch(0.145 0 0)");
  });

  test("uses text the caller already read, and an unreadable entry is empty", async () => {
    await sheet("theme.css", ":root { --primary: #111111; }");
    const entry = await sheet("index.css", "/* stale on disk */");
    const expanded = expandStylesheetImports(entry, { root: app, css: '@import "./theme.css";' });
    expect(expanded.css).toContain("--primary: #111111");

    expect(expand(join(app, "nope.css"))).toEqual({ css: "", followed: [], skipped: [] });
  });
});
