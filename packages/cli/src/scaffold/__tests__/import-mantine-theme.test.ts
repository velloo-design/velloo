import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveTheme } from "../../commands/init/scaffold.ts";
import type { WizardAnswers } from "../../wizard/answers.ts";
import { findMantineTheme, importThemeFromMantine } from "../import-mantine-theme.ts";

/**
 * A Mantine app is themed in JavaScript, where no stylesheet import can see
 * it, and mostly by omission: `primaryColor: "violet"` and nothing else. A
 * design that opened on the starter preset instead had every setup begin with
 * an agent copying `createTheme` over by hand — and looking violet up.
 */

let app: string;

async function write(rel: string, body: string): Promise<string> {
  const abs = join(app, rel);
  await mkdir(join(abs, ".."), { recursive: true });
  await writeFile(abs, body, "utf8");
  return abs;
}

const read = () => importThemeFromMantine(findMantineTheme(app), app);

beforeEach(async () => {
  app = await mkdtemp(join(tmpdir(), "velloo-mantine-theme-"));
});
afterEach(async () => {
  await rm(app, { recursive: true, force: true });
});

const ENTRY = `import "@mantine/core/styles.css";
import { MantineProvider, createTheme } from "@mantine/core";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";

const theme = createTheme({
  primaryColor: "violet",
  defaultRadius: "md",
  fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
  headings: { fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif", fontWeight: "700" },
  colors: {
    night: ["#f1f3f9", "#dce0ec", "#b6bfd5", "#8d9bbb", "#6b7ca5", "#566a98", "#495d8f", "#3b4d7d", "#303f69", "#18213d"],
  },
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <MantineProvider theme={theme} defaultColorScheme="light"><App /></MantineProvider>,
);
`;

describe("importThemeFromMantine", () => {
  test("a named primary is Mantine's own colour at the shade that fills a button", async () => {
    const file = await write("src/main.jsx", ENTRY);
    const imported = read();
    expect(imported?.importedFrom).toBe(file);
    expect(imported?.theme.colors).toMatchObject({
      primary: { DEFAULT: "#7950f2", foreground: "#fff" },
      background: "#fff",
      foreground: "#000",
      border: "#dee2e6",
      muted: { DEFAULT: "#f1f3f5", foreground: "#868e96" },
      destructive: { DEFAULT: "#fa5252", foreground: "#fff" },
      ring: "#7950f2",
    });
    // The `light` variant: the fill at 10% over the body, as one colour.
    expect(imported?.theme.colors.secondary).toEqual({ DEFAULT: "#f2eefe", foreground: "#7950f2" });
    expect(imported?.theme.radius.md).toBe(8);
    expect(imported?.notImported).toEqual([]);
  });

  test("the theme's fonts are set and loaded; headings follow the body unless told otherwise", async () => {
    await write(
      "src/theme.ts",
      `import { createTheme } from "@mantine/core";
       export const theme = createTheme({ fontFamily: "Inter, sans-serif", fontFamilyMonospace: "JetBrains Mono, monospace" });`,
    );
    const imported = read();
    expect(imported?.fonts).toEqual(["Inter", "JetBrains Mono"]);
    const { fontFamily, googleFonts } = imported?.theme.typography ?? {};
    expect(fontFamily?.sans).toBe('"Inter", sans-serif');
    expect(fontFamily?.display).toBe('"Inter", sans-serif');
    expect(fontFamily?.mono).toBe('"JetBrains Mono", monospace');
    expect(googleFonts?.some((entry) => entry.startsWith("Inter:"))).toBe(true);
    expect(googleFonts?.some((entry) => entry.startsWith("JetBrains+Mono"))).toBe(true);
  });

  test("the app's own colours come along as the scale they are", async () => {
    await write("src/main.jsx", ENTRY);
    const palette = read()?.theme.palette ?? {};
    expect(palette["night-0"]).toBe("#f1f3f9");
    expect(palette["night-9"]).toBe("#18213d");
    expect(Object.keys(palette).filter((key) => key.startsWith("night-"))).toHaveLength(10);
  });

  test("a tuple held in a const — what Mantine's colour generator hands out — is followed", async () => {
    await write(
      "theme.ts",
      `import { createTheme, type MantineColorsTuple } from "@mantine/core";
       const oceanBlue: MantineColorsTuple = ['#e5f4ff', '#cde2ff', '#9bc2ff', '#64a0ff', '#3984fe', '#1d72fe', '#0969ff', '#0058e4', '#004ecc', '#0043b5'];
       export const theme = createTheme({ colors: { oceanBlue }, primaryColor: 'oceanBlue', primaryShade: 5, defaultRadius: 10 });`,
    );
    const imported = read();
    expect(imported?.theme.colors.primary).toEqual({ DEFAULT: "#1d72fe", foreground: "#fff" });
    expect(imported?.theme.palette?.["ocean-blue-6"]).toBe("#0969ff");
    expect(imported?.theme.radius.md).toBe(10);
  });

  test("shades worked out in code are said, and the primary is left alone", async () => {
    await write(
      "src/theme.ts",
      `import { createTheme } from "@mantine/core";
       import { generateColors } from "@mantine/colors-generator";
       export const theme = createTheme({ primaryColor: "brand", colors: { brand: generateColors("#375EAC") } });`,
    );
    const imported = read();
    const untouched = importThemeFromMantine(undefined, app);
    expect(imported?.notImported.map((entry) => entry.what)).toEqual([
      'the primary colour (`generateColors("#375EAC")`)',
    ]);
    // The rest of the theme is still Mantine's, and the primary is not guessed at.
    expect(imported?.theme.colors.border).toBe("#dee2e6");
    expect(imported?.theme.colors.primary).not.toEqual(untouched?.theme.colors.primary);
  });

  test("an app that sets no theme is on Mantine's defaults, and so is the design", async () => {
    await write(
      "src/main.tsx",
      `import { MantineProvider } from "@mantine/core";
       root.render(<MantineProvider><App /></MantineProvider>);`,
    );
    const imported = read();
    expect(imported?.importedFrom).toBeUndefined();
    expect(imported?.theme.colors.primary).toEqual({ DEFAULT: "#228be6", foreground: "#fff" });
    expect(imported?.theme.radius.md).toBe(4);
  });

  test("the dark scheme is Mantine's too, not the starter preset's", async () => {
    await write("src/main.jsx", ENTRY);
    expect(read()?.theme.colorsDark).toMatchObject({
      background: "#242424",
      foreground: "#C9C9C9",
      primary: { DEFAULT: "#6741d9", foreground: "#fff" },
      muted: { DEFAULT: "#2e2e2e", foreground: "#828282" },
      border: "#424242",
    });
  });

  test("a family nothing here can load keeps the app's stack and is left for setup", async () => {
    await write(
      "src/theme.ts",
      `import { createTheme } from "@mantine/core";
       export const theme = createTheme({ fontFamily: "Greycliff CF, sans-serif", radius: { lg: "1.25rem" }, defaultRadius: "lg" });`,
    );
    const imported = read();
    expect(imported?.theme.typography.fontFamily?.sans).toBe("Greycliff CF, sans-serif");
    expect(imported?.theme.radius.md).toBe("1.25rem");
    expect(imported?.notImported.map((entry) => entry.what)).toEqual([
      "how the app loads `Greycliff CF`",
    ]);
  });

  test("a next/font face handed to the theme is traced to its family", async () => {
    await write(
      "theme.ts",
      `import { createTheme } from "@mantine/core";
       import { Space_Grotesk } from "next/font/google";
       const grotesk = Space_Grotesk({ subsets: ["latin"] });
       export const theme = createTheme({ fontFamily: grotesk.style.fontFamily, headings: { fontFamily: someOther.thing } });`,
    );
    const imported = read();
    expect(imported?.fonts).toEqual(["Space Grotesk"]);
    expect(imported?.theme.typography.fontFamily?.sans).toStartWith('"Space Grotesk"');
    expect(imported?.notImported.map((entry) => entry.what)).toEqual([
      "the font `someOther.thing`",
    ]);
  });
});

describe("findMantineTheme", () => {
  test("finds the theme wherever the app keeps it, and not another library's", async () => {
    await write(
      "src/mui.ts",
      `import { createTheme } from "@mui/material/styles";\nexport default createTheme({ palette: {} });`,
    );
    await write(
      "node_modules/@mantine/core/theme.js",
      `import x from "@mantine/core"; createTheme({ primaryColor: "red" });`,
    );
    expect(findMantineTheme(app)).toBeUndefined();
    const file = await write(
      "src/styles/brand.ts",
      `import type { MantineThemeOverride } from "@mantine/core";\nexport const brand: MantineThemeOverride = { primaryColor: "teal" };`,
    );
    expect(findMantineTheme(app)).toBe(file);
    expect(read()?.theme.colors.primary).toEqual({ DEFAULT: "#12b886", foreground: "#fff" });
  });
});

describe("resolveTheme on a Mantine app", () => {
  const answers = (): WizardAnswers => ({
    appRoot: app,
    scanRoot: app,
    folder: join(app, "velloo"),
    library: "none",
    source: "binary",
    componentsRelative: "components/ui",
    initialContent: "blank",
    detected: { shadcn: false, tailwindMajor: null, unsupportedUi: "Mantine" },
  });

  test("the design opens on the app's Mantine theme, and says where its fonts came from", async () => {
    const file = await write("src/main.jsx", ENTRY);
    const resolved = resolveTheme(answers());
    expect(resolved.importedFrom).toBe(file);
    expect(resolved.fonts).toEqual(["Inter"]);
    expect(resolved.fontsFrom).toBe("your Mantine theme");
    expect(resolved.leftForSetup).toBeUndefined();
    expect(JSON.stringify(resolved.theme.colors.primary)).toContain("#7950f2");
  });

  test("with no theme module it is Mantine's defaults, named as that", () => {
    const resolved = resolveTheme(answers());
    expect(resolved.importedFrom).toBeUndefined();
    expect(resolved.libraryDefaults).toBe("Mantine");
    expect(JSON.stringify(resolved.theme.colors.primary)).toContain("#228be6");
  });
});
