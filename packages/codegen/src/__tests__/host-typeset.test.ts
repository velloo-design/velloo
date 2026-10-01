import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Theme } from "@velloo/schema";
import { emitTheme } from "../emit-theme/index.ts";
import { hostTailwindAdvisory, missingTypesetUtilities } from "../host-typeset.ts";
import { configThemeKeys } from "../import-theme/parse-tailwind-config.ts";

const THEME: Theme = {
  name: "host-typeset",
  colors: { background: "#ffffff", foreground: "#111111", primary: "#222222" },
  typography: {},
  spacing: {},
  radius: {},
};

/** The classes the Heading/Text helpers lower to, plus ordinary ones. */
const CLASSES = [
  "flex",
  "text-body",
  "leading-body",
  "tracking-body",
  "md:tracking-h1",
  "text-muted-foreground",
  "shadow-xs",
];

function app(tailwind: string, files: Record<string, string> = {}): string {
  const dir = join(tmpdir(), `velloo-host-typeset-${Date.now()}-${Math.random()}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ devDependencies: { tailwindcss: tailwind } }),
  );
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), contents);
  }
  return dir;
}

const V3_CONFIG = `import type { Config } from "tailwindcss";
export default {
  content: ["./app/**/*.tsx"],
  theme: { extend: { colors: { ink: "hsl(var(--ink))" } } },
} satisfies Config;
`;

describe("hostTailwindAdvisory — Tailwind v3", () => {
  test("a v3 app that never ran emit_theme is told which typeset utilities it lacks", () => {
    const root = app("^3.4.15", {
      "tailwind.config.ts": V3_CONFIG,
      "app/globals.css": "@tailwind base;\n@tailwind utilities;\n",
    });
    const advisory = hostTailwindAdvisory(root, CLASSES);
    expect(advisory.warnings).toHaveLength(1);
    const warning = advisory.warnings[0] as string;
    for (const cls of ["text-body", "leading-body", "tracking-body", "tracking-h1"]) {
      expect(warning).toContain(`\`${cls}\``);
    }
    expect(warning).not.toContain("text-muted-foreground");
    expect(warning).toContain("emit_theme");
    expect(warning).toContain("Tailwind v3");
    // The v3 renames still ride along.
    expect(advisory.v3Compat.map((i) => i.class)).toEqual(["shadow-xs"]);
  });

  test("the preset emit_theme writes defines every typeset utility", async () => {
    const root = app("^3.4.15");
    await emitTheme(THEME, { outputDir: root, tailwindMajor: 3, apply: true });
    writeFileSync(
      join(root, "tailwind.config.js"),
      `module.exports = { presets: [require("./velloo.preset.cjs")], content: [] };\n`,
    );
    expect(hostTailwindAdvisory(root, CLASSES).warnings).toEqual([]);
  });

  test("hand-written theme keys count, and only the roles the app declares", () => {
    const root = app("^3.4.15", {
      "tailwind.config.ts": `export default { theme: { extend: {
        fontSize: { body: ["1rem", { lineHeight: "1.5" }] },
        lineHeight: { body: "1.5" },
      } } };`,
    });
    expect(missingTypesetUtilities(root, CLASSES)).toEqual(["tracking-body", "tracking-h1"]);
  });
});

describe("hostTailwindAdvisory — Tailwind v4", () => {
  test("a v4 app without the @theme typeset tokens is warned", () => {
    const root = app("^4.1.0", {
      "app/globals.css": `@import "tailwindcss";\n@theme inline {\n  --color-ink: #111;\n}\n`,
    });
    const advisory = hostTailwindAdvisory(root, CLASSES);
    expect(advisory.v3Compat).toEqual([]);
    expect(advisory.warnings[0]).toContain("Tailwind v4");
    expect(advisory.warnings[0]).toContain("`tracking-h1`");
  });

  test("the globals.css emit_theme writes defines every typeset utility", async () => {
    const root = app("^4.1.0");
    await emitTheme(THEME, { outputDir: root, apply: true });
    expect(hostTailwindAdvisory(root, CLASSES).warnings).toEqual([]);
  });

  test("tokens declared outside @theme — or inside the design folder — don't count", () => {
    const root = app("^4.1.0", {
      "app/globals.css": `@import "tailwindcss";\n:root { --text-body: 1rem; }\n`,
      "design/theme/canvas.css": `@theme { --text-body: 1rem; --leading-body: 1.75; --tracking-body: 0; --tracking-h1: 0; }`,
    });
    expect(missingTypesetUtilities(root, CLASSES, [join(root, "design")])).toEqual([
      "text-body",
      "leading-body",
      "tracking-body",
      "tracking-h1",
    ]);
  });
});

describe("hostTailwindAdvisory — no Tailwind", () => {
  test("an app that doesn't declare Tailwind gets no advisory", () => {
    const root = join(tmpdir(), `velloo-host-typeset-none-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    expect(hostTailwindAdvisory(root, CLASSES)).toEqual({ v3Compat: [], warnings: [] });
  });

  test("a screen with no typeset classes needs no scan", () => {
    expect(missingTypesetUtilities("/nonexistent", ["flex", "text-lg", "tracking-tight"])).toEqual(
      [],
    );
  });
});

describe("configThemeKeys", () => {
  test("reads quoted (preset JSON) and bare keys, from theme and theme.extend", () => {
    const src = `{ "theme": { "fontSize": { "h1": ["var(--text-h1)", { "lineHeight": "x" }] },
      "extend": { fontSize: { body: "1rem" } } } }`;
    expect([...configThemeKeys(src, "fontSize")].sort()).toEqual(["body", "h1"]);
    // The lineHeight inside a fontSize tuple is not a lineHeight namespace.
    expect(configThemeKeys(src, "lineHeight").size).toBe(0);
  });
});
