import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findMuiTheme, importThemeFromMui } from "../import-mui-theme.ts";

/**
 * The MUI side of the "existing project" theme import: read a `createTheme(...)`
 * module and project its palette/shape/typography back onto velloo tokens — the
 * inverse of provider-mui's muiThemeOptions.
 */

let tmp: string;

async function write(rel: string, body: string): Promise<string> {
  const abs = join(tmp, rel);
  await mkdir(join(abs, ".."), { recursive: true });
  await writeFile(abs, body, "utf8");
  return abs;
}

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-muitheme-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tmp, { recursive: true });
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("importThemeFromMui", () => {
  test("maps palette / shape / typography onto velloo tokens", async () => {
    const file = await write(
      "theme.ts",
      `import { createTheme } from "@mui/material/styles";
       export const theme = createTheme({
         palette: {
           mode: "light",
           primary: { main: "#1976d2", contrastText: "#ffffff" },
           error: { main: "#d32f2f" },
           background: { default: "#fafafa", paper: "#ffffff" },
           text: { primary: "#1a1a1a", secondary: "#666" },
           divider: "rgba(0,0,0,0.12)",
         },
         shape: { borderRadius: 10 },
         typography: { fontFamily: "Roboto, sans-serif" },
       });`,
    );
    const imported = importThemeFromMui(file);
    expect(imported).not.toBeNull();
    if (!imported) return;
    const c = imported.theme.colors;
    expect(c.primary).toEqual({ DEFAULT: "#1976d2", foreground: "#ffffff" });
    expect(c.destructive).toEqual({ DEFAULT: "#d32f2f", foreground: "#ffffff" });
    expect(c.background).toBe("#fafafa");
    expect(c.card).toEqual({ DEFAULT: "#ffffff", foreground: "#1a1a1a" });
    expect(c.foreground).toBe("#1a1a1a");
    expect(c.border).toBe("rgba(0,0,0,0.12)");
    expect(imported.theme.radius?.md).toBe(10);
    expect(imported.theme.typography.fontFamily?.sans).toBe("Roboto, sans-serif");
  });

  test("handles createTheme aliased through a namespace import", async () => {
    const file = await write(
      "theme.ts",
      `import * as mui from "@mui/material/styles";
       export default mui.createTheme({ palette: { primary: { main: "#0a0" } } });`,
    );
    const imported = importThemeFromMui(file);
    expect(imported?.theme.colors.primary).toEqual({ DEFAULT: "#0a0", foreground: "#ffffff" });
  });

  test("returns null when there is no createTheme call", async () => {
    const file = await write("theme.ts", `export const x = 1;`);
    expect(importThemeFromMui(file)).toBeNull();
  });

  test("ignores comments inside the options object", async () => {
    const file = await write(
      "theme.ts",
      `import { createTheme } from "@mui/material/styles";
       export const theme = createTheme({
         palette: {
           // brand blue, see design doc
           primary: { main: "#1976d2" /* contrastText comes from the preset */ },
         },
         /* rounded corners: borderRadius: 999 (old value) */
         shape: { borderRadius: 6 },
       });`,
    );
    const imported = importThemeFromMui(file);
    expect(imported?.theme.colors.primary).toEqual({ DEFAULT: "#1976d2", foreground: "#ffffff" });
    expect(imported?.theme.radius?.md).toBe(6);
  });

  test("a createTheme( inside a // comment is not a call", async () => {
    const file = await write(
      "theme.ts",
      `// TODO: wrap this in createTheme({ palette: { primary: { main: "#bad" } } })
       export const theme = {};`,
    );
    expect(importThemeFromMui(file)).toBeNull();
  });

  test("string values containing braces, parens, and quotes parse intact", async () => {
    const file = await write(
      "theme.ts",
      `export const theme = createTheme({
         palette: {
           primary: { main: "rgb(25, 118, 210)" },
           divider: 'color-mix(in oklch, black 12%, white)',
         },
         typography: { fontFamily: \`"Helvetica Neue", 'Segoe UI', {weird} (stack)\` },
       });`,
    );
    const imported = importThemeFromMui(file);
    expect(imported?.theme.colors.primary).toEqual({
      DEFAULT: "rgb(25, 118, 210)",
      foreground: "#ffffff",
    });
    expect(imported?.theme.colors.border).toBe("color-mix(in oklch, black 12%, white)");
    expect(imported?.theme.typography.fontFamily?.sans).toBe(
      `"Helvetica Neue", 'Segoe UI', {weird} (stack)`,
    );
  });

  test("tolerates trailing commas", async () => {
    const file = await write(
      "theme.ts",
      `export const theme = createTheme({
         palette: { primary: { main: "#0a0", }, },
         shape: { borderRadius: 4, },
       });`,
    );
    const imported = importThemeFromMui(file);
    expect(imported?.theme.colors.primary).toEqual({ DEFAULT: "#0a0", foreground: "#ffffff" });
    expect(imported?.theme.radius?.md).toBe(4);
  });

  test("handles `satisfies ThemeOptions` after the literal", async () => {
    const file = await write(
      "theme.ts",
      `import { createTheme, type ThemeOptions } from "@mui/material/styles";
       export const theme = createTheme({
         palette: { primary: { main: "#1976d2" } },
       } satisfies ThemeOptions);`,
    );
    const imported = importThemeFromMui(file);
    expect(imported?.theme.colors.primary).toEqual({ DEFAULT: "#1976d2", foreground: "#ffffff" });
  });

  test("skips non-literal values without losing literal siblings", async () => {
    const file = await write(
      "theme.ts",
      `const blue = "#00f";
       export const theme = createTheme({
         ...baseOptions,
         palette: {
           primary: { main: blue },
           secondary: { main: "#9c27b0" },
           background: { default: \`\${bg}\` },
         },
         shape: { borderRadius: radii.md },
         typography: { fontFamily: "Inter, sans-serif" },
       });`,
    );
    const imported = importThemeFromMui(file);
    expect(imported).not.toBeNull();
    expect(imported?.theme.colors.secondary).toEqual({ DEFAULT: "#9c27b0", foreground: "#ffffff" });
    expect(String(imported?.theme.colors.background)).not.toMatch(/\$\{/);
    expect(imported?.theme.typography.fontFamily?.sans).toBe("Inter, sans-serif");
  });

  test("returns null for an unreadable file", () => {
    expect(importThemeFromMui(join(tmp, "nope.ts"))).toBeNull();
  });
});

describe("findMuiTheme", () => {
  test("locates a common theme module containing createTheme", async () => {
    const file = await write(
      "src/theme.ts",
      `import { createTheme } from "@mui/material/styles"; export const theme = createTheme({});`,
    );
    expect(findMuiTheme(tmp)).toBe(file);
  });

  test("ignores a same-named file without createTheme", async () => {
    await write("src/theme.ts", `export const theme = {};`);
    expect(findMuiTheme(tmp)).toBeUndefined();
  });
});
