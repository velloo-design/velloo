import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { findFontLoader } from "../font-loaders.ts";

let app: string;

async function file(path: string, source: string): Promise<void> {
  await mkdir(dirname(join(app, path)), { recursive: true });
  await writeFile(join(app, path), source);
}

beforeEach(async () => {
  app = await mkdtemp(join(tmpdir(), "velloo-font-loaders-"));
});

afterEach(async () => {
  await rm(app, { recursive: true, force: true });
});

describe("findFontLoader", () => {
  test("names the family and weights next/font loads for a variable", async () => {
    await file(
      "app/layout.tsx",
      `
      import { Archivo_Black, Space_Grotesk, IBM_Plex_Mono as Mono } from "next/font/google";

      const display = Archivo_Black({ subsets: ["latin"], weight: "400", variable: "--font-display" });
      const sans = Space_Grotesk({ subsets: ["latin"], variable: "--font-sans" });
      const mono = Mono({
        subsets: ["latin"],
        weight: ["600", "400", "500"],
        variable: "--font-mono",
      });
      export default function Layout({ children }) { return <html>{children}</html>; }
    `,
    );
    expect(findFontLoader(app, "--font-display")).toEqual({
      file: "app/layout.tsx",
      family: "Archivo Black",
      google: "wght@400",
    });
    // No weight stated is a variable face: the loader has no range to give.
    expect(findFontLoader(app, "--font-sans")).toEqual({
      file: "app/layout.tsx",
      family: "Space Grotesk",
    });
    expect(findFontLoader(app, "--font-mono")).toEqual({
      file: "app/layout.tsx",
      family: "IBM Plex Mono",
      google: "wght@400;500;600",
    });
  });

  test("a local font file is found, and has no family to name", async () => {
    await file(
      "src/app/fonts.ts",
      `
      import localFont from "next/font/local";
      export const brand = localFont({
        src: [{ path: "./Brand-Regular.woff2", weight: "400" }],
        variable: "--font-brand",
      });
    `,
    );
    expect(findFontLoader(app, "--font-brand")).toEqual({ file: "src/app/fonts.ts" });
  });

  test("a variable no loader sets, or an app with no loader at all, finds nothing", async () => {
    expect(findFontLoader(app, "--font-sans")).toBeNull();
    await file(
      "app/layout.tsx",
      `import { Inter } from "next/font/google";
       const inter = Inter({ variable: "--font-inter" });`,
    );
    expect(findFontLoader(app, "--font-sans")).toBeNull();
    // An object literal with the variable in it is not a loader call.
    await file("pages/_app.tsx", `const theme = makeTheme({ variable: "--font-sans" });`);
    expect(findFontLoader(app, "--font-sans")).toBeNull();
  });
});
