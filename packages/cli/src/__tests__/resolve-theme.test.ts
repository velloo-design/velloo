import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveTheme } from "../commands/init/scaffold.ts";
import type { WizardAnswers } from "../wizard/answers.ts";

/**
 * Which source seeds a new design's theme when the scan found several. A
 * DESIGN.md is a design system someone wrote down, so it leads; the answer to
 * the wizard's offer (or `--no-design-md`) is what can send it back to the
 * stylesheet.
 */

const DESIGN_MD = `---
name: Paws & Paths
colors:
  background: "#f9f9ff"
  primary: "#855300"
---
`;

let app: string;
beforeEach(async () => {
  app = await mkdtemp(join(tmpdir(), "velloo-resolve-theme-"));
  await writeFile(join(app, "DESIGN.md"), DESIGN_MD, "utf8");
  await writeFile(
    join(app, "globals.css"),
    '@import "tailwindcss";\n:root{--primary: oklch(0.6 0.2 25);}\n',
    "utf8",
  );
});
afterEach(async () => {
  await rm(app, { recursive: true, force: true });
});

function answers(overrides: Partial<WizardAnswers> = {}): WizardAnswers {
  return {
    appRoot: app,
    scanRoot: app,
    folder: join(app, "velloo"),
    library: "shadcn-upstream",
    source: "binary",
    componentsRelative: "components/ui",
    initialContent: "redesign-screen",
    detected: {
      shadcn: true,
      tailwindMajor: 4,
      globalsCssPath: join(app, "globals.css"),
      designMdPath: join(app, "DESIGN.md"),
    },
    ...overrides,
  };
}

describe("resolveTheme", () => {
  test("a DESIGN.md leads, and comes back as the file to follow", () => {
    const r = resolveTheme(answers());
    expect(JSON.stringify(r.theme.colors.primary)).toContain("#855300");
    expect(r.designMd?.path).toBe(join(app, "DESIGN.md"));
    expect(r.designMd?.name).toBe("Paws & Paths");
    expect(r.designMd?.coverage.semantic).toBeGreaterThan(0);
  });

  test("roles the DESIGN.md does not name keep the stylesheet's, not the preset's", async () => {
    await writeFile(
      join(app, "globals.css"),
      '@import "tailwindcss";\n:root{--primary: oklch(0.6 0.2 25); --secondary: oklch(0.97 0.01 250); --accent: oklch(0.96 0.02 80);}\n',
      "utf8",
    );
    const r = resolveTheme(answers());
    expect(JSON.stringify(r.theme.colors.primary)).toContain("#855300");
    expect(JSON.stringify(r.theme.colors.secondary)).toContain("oklch(0.97 0.01 250)");
    expect(JSON.stringify(r.theme.colors.accent)).toContain("oklch(0.96 0.02 80)");
  });

  test("a stylesheet's --radius replaces the preset's corner scale", async () => {
    await writeFile(
      join(app, "globals.css"),
      '@import "tailwindcss";\n:root{--primary: oklch(0.6 0.2 25); --radius: 0rem;}\n',
      "utf8",
    );
    const r = resolveTheme(answers({ useDesignMd: false }));
    // Not `{ sm: 4, md: "0rem", lg: 8, xl: 12 }` — a square app with rounded cards.
    expect(r.theme.radius).toEqual({ md: "0rem", full: 9999 });
  });

  test("declining it takes the stylesheet, and follows nothing", () => {
    const r = resolveTheme(answers({ useDesignMd: false }));
    expect(JSON.stringify(r.theme.colors.primary)).toContain("oklch(0.6 0.2 25)");
    expect(r.importedFrom).toBe(join(app, "globals.css"));
    expect(r.designMd).toBeUndefined();
  });

  test("a DESIGN.md with nothing to map falls through to the stylesheet", async () => {
    await writeFile(join(app, "DESIGN.md"), "# Acme\n\n## Overview\n\nCalm.\n", "utf8");
    const r = resolveTheme(answers());
    expect(r.importedFrom).toBe(join(app, "globals.css"));
    expect(r.designMd).toBeUndefined();
  });

  test("tokens in a sheet the stylesheet imports are the theme, and the sheet is named", async () => {
    await mkdir(join(app, "src", "styles"), { recursive: true });
    const entry = join(app, "src", "styles", "index.css");
    const tokens = join(app, "src", "styles", "theme.css");
    await writeFile(
      entry,
      "@import 'tailwindcss';\n@import 'tw-animate-css';\n@import './theme.css';\n",
      "utf8",
    );
    await writeFile(
      tokens,
      ":root{--primary: oklch(0.208 0.042 265.755); --radius: 0.625rem;}\n.dark{--primary: oklch(0.929 0.013 255.508);}\n",
      "utf8",
    );
    const r = resolveTheme(
      answers({ detected: { shadcn: true, tailwindMajor: 4, globalsCssPath: entry } }),
    );
    expect(JSON.stringify(r.theme.colors.primary)).toContain("oklch(0.208 0.042 265.755)");
    expect(JSON.stringify(r.theme.colorsDark?.primary)).toContain("oklch(0.929 0.013 255.508)");
    expect(r.theme.radius.md).toBe("0.625rem");
    expect(r.importedFrom).toBe(entry);
    expect(r.importedVia).toEqual([tokens]);
    expect(r.tokenlessStylesheet).toBeUndefined();
  });

  test("a stylesheet with no tokens anywhere is reported, not passed off as a choice of preset", async () => {
    await writeFile(join(app, "globals.css"), '@import "tailwindcss";\n', "utf8");
    const preset = resolveTheme(answers({ detected: undefined }));
    const r = resolveTheme(
      answers({
        detected: { shadcn: true, tailwindMajor: 4, globalsCssPath: join(app, "globals.css") },
      }),
    );
    expect(r.importedFrom).toBeUndefined();
    expect(r.tokenlessStylesheet).toBe(join(app, "globals.css"));
    // The preset's colours — only its faces are held back, since there is an app.
    expect(r.theme.colors).toEqual(preset.theme.colors);
    expect(r.theme.radius).toEqual(preset.theme.radius);
  });

  test("a stylesheet that themed the design is never also reported as tokenless", () => {
    const r = resolveTheme(answers({ useDesignMd: false }));
    expect(r.tokenlessStylesheet).toBeUndefined();
    expect(r.importedVia).toBeUndefined();
  });

  test("a new design opens on what an agent's import would have given it", async () => {
    // The shape of a shadcn + Tailwind 3 + next/font app.
    await mkdir(join(app, "app"), { recursive: true });
    await writeFile(
      join(app, "app", "globals.css"),
      ":root { --background: 46 24% 92%; --primary: 64 92% 52%; --acid: 64 92% 52%; --radius: 0rem; }\n",
    );
    await writeFile(
      join(app, "tailwind.config.ts"),
      `export default { theme: { extend: {
        colors: { primary: { DEFAULT: "hsl(var(--primary))" }, acid: "hsl(var(--acid))" },
        fontFamily: { display: ["var(--font-display)", "Impact"], sans: ["var(--font-sans)", "sans-serif"] },
        boxShadow: { stamp: "4px 4px 0 0 #000" },
        letterSpacing: { machine: "0.22em" },
      } } };`,
    );
    await writeFile(
      join(app, "app", "layout.tsx"),
      `import { Archivo_Black, Space_Grotesk } from "next/font/google";
       const display = Archivo_Black({ weight: "400", variable: "--font-display" });
       const sans = Space_Grotesk({ variable: "--font-sans" });`,
    );
    const r = resolveTheme(
      answers({
        useDesignMd: false,
        detected: { shadcn: true, tailwindMajor: 3, globalsCssPath: join(app, "app/globals.css") },
      }),
    );
    // The app's own colour, shadow and fonts — traced to the loader, at its weights.
    expect(r.theme.palette).toEqual({ acid: "hsl(64 92% 52%)" });
    expect(r.theme.shadows?.stamp).toBe("4px 4px 0 0 #000");
    expect(r.theme.typography.fontFamily?.display).toStartWith('"Archivo Black", ');
    expect(r.theme.typography.googleFonts).toEqual([
      "Archivo+Black:wght@400",
      "Space+Grotesk:wght@300..700",
    ]);
    expect(r.fonts).toEqual(["Archivo Black", "Space Grotesk"]);
    // And what it could not carry is named, for setup.
    expect(r.leftForSetup).toEqual([
      "tailwind.config theme.extend.letterSpacing (machine)",
      "a dark palette",
    ]);
  });

  test("an app that states no fonts opens on the system's, not the starter's", async () => {
    const r = resolveTheme(answers({ useDesignMd: false }));
    // DM Sans and DM Serif Display are the welcome sample's look; under an
    // app's colours they read as the app's fonts being wrong.
    expect(JSON.stringify(r.theme.typography.fontFamily)).not.toContain("DM ");
    expect(r.theme.typography.googleFonts).toEqual([]);
    expect(r.theme.typography.fontFamily?.sans).toBe("ui-sans-serif, system-ui, sans-serif");
  });

  test("an app whose theme no stylesheet holds still does not open on the starter's faces", async () => {
    // Themed in JavaScript (a Mantine or Chakra theme object): nothing to import.
    await writeFile(join(app, "package.json"), JSON.stringify({ name: "app" }));
    const r = resolveTheme(
      answers({ useDesignMd: false, detected: { shadcn: false, tailwindMajor: null } }),
    );
    expect(r.importedFrom).toBeUndefined();
    expect(JSON.stringify(r.theme.typography.fontFamily)).not.toContain("DM ");
    // The welcome sample is Velloo's own look, and keeps it.
    const sample = resolveTheme(
      answers({ useDesignMd: false, initialContent: "sample", detected: undefined }),
    );
    expect(JSON.stringify(sample.theme.typography.fontFamily)).toContain("DM ");
  });

  test("no detection ⇒ the preset", () => {
    const r = resolveTheme(answers({ detected: undefined }));
    expect(r.importedFrom).toBeUndefined();
    expect(r.designMd).toBeUndefined();
  });
});
