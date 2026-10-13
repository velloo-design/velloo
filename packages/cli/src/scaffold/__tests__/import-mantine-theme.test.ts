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

  test("a theme written inline on the provider is read where it is", async () => {
    const file = await write(
      "src/main.tsx",
      `import { MantineProvider } from "@mantine/core";
       root.render(
         <MantineProvider defaultColorScheme="auto" theme={{ primaryColor: "grape", defaultRadius: "xl" }}>
           <App />
         </MantineProvider>,
       );`,
    );
    const imported = read();
    expect(imported?.importedFrom).toBe(file);
    expect(imported?.theme.colors.primary).toEqual({ DEFAULT: "#be4bdb", foreground: "#fff" });
    expect(imported?.theme.radius.md).toBe(32);
  });

  test("the shade that fills a button can differ by scheme", async () => {
    await write(
      "src/theme.ts",
      `import { createTheme } from "@mantine/core";
       export const theme = createTheme({
         primaryColor: "brand",
         primaryShade: { light: 4, dark: 9 },
         colors: { brand: ["#b0", "#b1", "#b2", "#b3", "#b4", "#b5", "#b6", "#b7", "#b8", "#b9"] },
       });`,
    );
    const imported = read();
    expect(imported?.theme.colors.primary).toMatchObject({ DEFAULT: "#b4" });
    expect(imported?.theme.colorsDark?.primary).toMatchObject({ DEFAULT: "#b9" });
    expect(imported?.theme.colors.ring).toBe("#b4");
  });

  test("the theme's own white and black are the page and the text on it", async () => {
    await write(
      "src/theme.ts",
      `import { createTheme } from "@mantine/core";
       export const theme = createTheme({ white: "#fefefe", black: "#111111", defaultRadius: "12px" });`,
    );
    const imported = read();
    expect(imported?.theme.colors).toMatchObject({
      background: "#fefefe",
      foreground: "#111111",
      card: { DEFAULT: "#fefefe", foreground: "#111111" },
      primary: { DEFAULT: "#228be6", foreground: "#fefefe" },
    });
    // A length is kept as written; a name is looked up on Mantine's scale.
    expect(imported?.theme.radius.md).toBe("12px");
  });

  test("a font the theme takes from a CSS variable is traced to the loader that sets it", async () => {
    await write(
      "app/layout.tsx",
      `import { Inter } from "next/font/google";
       const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });`,
    );
    await write(
      "theme.ts",
      `import { createTheme } from "@mantine/core";
       export const theme = createTheme({ fontFamily: "var(--font-inter), sans-serif" });`,
    );
    const imported = read();
    expect(imported?.fonts).toEqual(["Inter"]);
    expect(imported?.theme.typography.fontFamily?.sans).toStartWith('"Inter", ');
    expect(
      imported?.theme.typography.googleFonts?.some((entry) => entry.startsWith("Inter:")),
    ).toBe(true);
    expect(imported?.notImported).toEqual([]);
  });

  test("a variable no loader sets is named for setup rather than guessed at", async () => {
    await write(
      "theme.ts",
      `import { createTheme } from "@mantine/core";
       export const theme = createTheme({ fontFamily: "var(--font-brand), sans-serif" });`,
    );
    const imported = read();
    expect(imported?.fonts).toEqual([]);
    expect(imported?.notImported.map((entry) => entry.what)).toEqual([
      "the font `var(--font-brand), sans-serif`",
    ]);
    expect(imported?.theme.typography.fontFamily?.sans).toBe(
      "ui-sans-serif, system-ui, sans-serif",
    );
  });

  test("a theme file that cannot be read is no theme: Mantine's defaults, from nowhere", () => {
    const imported = importThemeFromMantine(join(app, "src/gone.ts"), app);
    expect(imported?.importedFrom).toBeUndefined();
    expect(imported?.theme.colors.primary).toEqual({ DEFAULT: "#228be6", foreground: "#fff" });
  });
});

describe("findMantineTheme", () => {
  test("the provider and the theme in different files: the theme's is the one found", async () => {
    // The provider's file is shallower and comes first; it only passes the theme along.
    await write(
      "src/main.tsx",
      `import { MantineProvider } from "@mantine/core";
       import { theme } from "./styles/theme";
       root.render(<MantineProvider theme={theme}><App /></MantineProvider>);`,
    );
    expect(findMantineTheme(app)).toBeUndefined();
    const file = await write(
      "src/styles/theme.ts",
      `import { createTheme } from "@mantine/core";
       export const theme = createTheme({ primaryColor: "teal" });`,
    );
    expect(findMantineTheme(app)).toBe(file);
    expect(read()?.importedFrom).toBe(file);
    expect(read()?.theme.colors.primary).toEqual({ DEFAULT: "#12b886", foreground: "#fff" });
  });

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

  test("a provider with no theme of its own is Mantine's defaults too, not an import", async () => {
    await write(
      "src/main.tsx",
      `import { MantineProvider } from "@mantine/core";
       root.render(<MantineProvider><App /></MantineProvider>);`,
    );
    const resolved = resolveTheme(answers());
    expect(resolved.importedFrom).toBeUndefined();
    expect(resolved.libraryDefaults).toBe("Mantine");
  });

  test("what the theme works out in code is left for setup, and the rest is still imported", async () => {
    const file = await write(
      "src/theme.ts",
      `import { createTheme } from "@mantine/core";
       import { generateColors } from "@mantine/colors-generator";
       export const theme = createTheme({ primaryColor: "brand", colors: { brand: generateColors("#375EAC") }, defaultRadius: "lg" });`,
    );
    const resolved = resolveTheme(answers());
    expect(resolved.importedFrom).toBe(file);
    expect(resolved.libraryDefaults).toBeUndefined();
    expect(resolved.leftForSetup).toEqual(['the primary colour (`generateColors("#375EAC")`)']);
    expect(resolved.theme.radius.md).toBe(16);
  });

  describe("beside a stylesheet with tokens of its own", () => {
    const withStylesheet = async (): Promise<WizardAnswers> => {
      const sheet = await write(
        "src/index.css",
        ":root { --primary: #ff0000; --acid: #d4f000; --font-sans: var(--font-body), sans-serif; }\n",
      );
      await write(
        "app/layout.tsx",
        `import { Inter, Lora } from "next/font/google";
         const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
         const body = Lora({ subsets: ["latin"], variable: "--font-body" });`,
      );
      const base = answers();
      return {
        ...base,
        detected: { ...base.detected, shadcn: false, tailwindMajor: null, globalsCssPath: sheet },
      };
    };

    test("the app's own colours stay, and Mantine's theme is what its components are painted with", async () => {
      const file = await write(
        "src/theme.ts",
        `import { createTheme } from "@mantine/core";\nexport const theme = createTheme({ primaryColor: "grape" });`,
      );
      const resolved = resolveTheme(await withStylesheet());
      expect(resolved.importedFrom).toBe(file);
      expect(resolved.theme.palette).toEqual({ acid: "#d4f000" });
      // Not the stylesheet's red: a Mantine button is filled with the theme's primary.
      expect(resolved.theme.colors.primary).toEqual({ DEFAULT: "#be4bdb", foreground: "#fff" });
    });

    test("fonts the Mantine theme does not name are the stylesheet's, traced to the font loader", async () => {
      await write(
        "src/theme.ts",
        `import { createTheme } from "@mantine/core";\nexport const theme = createTheme({ primaryColor: "grape" });`,
      );
      const resolved = resolveTheme(await withStylesheet());
      expect(resolved.fonts).toEqual(["Lora"]);
      // Unset, so init credits the app's font loader and not the Mantine theme.
      expect(resolved.fontsFrom).toBeUndefined();
      expect(resolved.theme.typography.fontFamily?.sans).toStartWith('"Lora", ');
    });

    test("fonts the Mantine theme names win, and are credited to it", async () => {
      await write(
        "src/theme.ts",
        `import { createTheme } from "@mantine/core";\nexport const theme = createTheme({ fontFamily: "var(--font-inter), sans-serif" });`,
      );
      const resolved = resolveTheme(await withStylesheet());
      expect(resolved.fonts).toEqual(["Inter"]);
      expect(resolved.fontsFrom).toBe("your Mantine theme");
      expect(resolved.theme.typography.fontFamily?.sans).toStartWith('"Inter", ');
    });

    test("what neither could carry is left for setup, the theme's first", async () => {
      await write(
        "src/theme.ts",
        `import { createTheme } from "@mantine/core";
         export const theme = createTheme({ primaryColor: "brand", colors: { brand: makeShades("#375EAC") } });`,
      );
      const resolved = resolveTheme(await withStylesheet());
      expect(resolved.leftForSetup?.[0]).toBe('the primary colour (`makeShades("#375EAC")`)');
      // The primary was not guessed at: it is still the stylesheet's.
      expect(JSON.stringify(resolved.theme.colors.primary)).toContain("#ff0000");
    });
  });
});
