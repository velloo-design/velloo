import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ConfigSchema, ThemeSchema } from "@velloo/schema";
import { runInit } from "../commands/init.ts";
import type { LibraryId } from "../wizard/answers.ts";
import type { InitCliArgs } from "../wizard/args.ts";

/**
 * The non-interactive init, run in this process: what an agent or a script
 * gets from `velloo init --non-interactive`. `init.test.ts` spawns the binary
 * for the end-to-end surface; this is the same flow at a speed that affords
 * the whole table — every kind of app against every start that is about it.
 */

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "velloo-init-run-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function app(name: string, files: Record<string, string>): Promise<string> {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    await mkdir(dirname(join(dir, rel)), { recursive: true });
    await writeFile(join(dir, rel), body, "utf8");
  }
  return dir;
}

const pkg = (dependencies: Record<string, string>, devDependencies: Record<string, string> = {}) =>
  JSON.stringify({ dependencies: { react: "^19.0.0", ...dependencies }, devDependencies });

/** Run init on `appRoot` and return everything it printed. A failure exits; here it throws. */
async function init(appRoot: string, args: Partial<InitCliArgs> = {}): Promise<string> {
  const log = spyOn(console, "log").mockImplementation(() => {});
  const error = spyOn(console, "error").mockImplementation(() => {});
  const exit = spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`init exited ${code}: ${error.mock.calls.map((c) => c.join(" ")).join("\n")}`);
  }) as never);
  try {
    await runInit({ folder: appRoot, nonInteractive: true, connect: false, ...args });
    return log.mock.calls.map((call) => call.join(" ")).join("\n");
  } finally {
    log.mockRestore();
    error.mockRestore();
    exit.mockRestore();
  }
}

async function config(appRoot: string, design = "velloo") {
  return ConfigSchema.parse(
    JSON.parse(await readFile(join(appRoot, design, ".design/config.json"), "utf8")),
  );
}

const libraryOf = async (appRoot: string, design?: string) =>
  (await config(appRoot, design)).libraries.default?.id;

/** Every start that is about the app, with the flags it needs. */
const STARTS: [string, Partial<InitCliArgs>][] = [
  ["blank", { start: "blank" }],
  ["custom", { start: "custom", request: "a pricing page" }],
  ["component", { start: "redesign-component", component: "sidebar" }],
  ["screen", { start: "redesign-screen", screenName: "Pricing" }],
  ["scan", { start: "scan" }],
];

describe("the library a design for an app is built on", () => {
  const APPS: [string, Record<string, string>, LibraryId][] = [
    [
      "no UI library",
      { "package.json": pkg({}), "src/App.tsx": "export default () => <main />;\n" },
      "none",
    ],
    ["Tailwind and no UI library", { "package.json": pkg({}, { tailwindcss: "^4.2.2" }) }, "none"],
    [
      "Mantine, which has no adapter",
      { "package.json": pkg({ "@mantine/core": "^8.0.0" }) },
      "none",
    ],
    ["Material UI", { "package.json": pkg({ "@mui/material": "^6.0.0" }) }, "mui"],
    ["Ant Design", { "package.json": pkg({ antd: "^5.0.0" }) }, "antd"],
    ["Chakra UI", { "package.json": pkg({ "@chakra-ui/react": "^2.0.0" }) }, "chakra"],
    [
      "shadcn",
      { "package.json": pkg({}), "components.json": JSON.stringify({ style: "new-york" }) },
      "shadcn-upstream",
    ],
  ];

  for (const [what, files, expected] of APPS) {
    test(`an app with ${what} is built on ${expected}, whichever way it starts`, async () => {
      for (const [start, args] of STARTS) {
        const dir = await app(start, files);
        const stdout = await init(dir, args);
        expect(await libraryOf(dir)).toBe(expected);
        expect(stdout).toMatch(new RegExp(`scaffolded .* \\(${expected} `));
        // shadcn is a library like any other: named only where the app has it.
        if (expected !== "shadcn-upstream") expect(stdout).not.toContain("shadcn");
      }
    });
  }

  test("an app that is only pages of HTML is designed as HTML", async () => {
    const dir = await app("static", {
      "index.html": '<link rel="stylesheet" href="site.css"><main>Hello</main>',
      "site.css": "main { color: rgb(1, 2, 3); }",
    });
    await init(dir, { start: "blank" });
    expect(await libraryOf(dir)).toBe("html");
  });

  test("--library is the user's to give, and outranks whatever the app uses", async () => {
    for (const [start, args] of STARTS) {
      const dir = await app(`pinned-${start}`, {
        "package.json": pkg({ "@mui/material": "^6.0.0" }),
      });
      const stdout = await init(dir, { ...args, library: "antd" });
      expect(await libraryOf(dir)).toBe("antd");
      expect(stdout).not.toContain("Detected mui");
    }
  });

  test("with no app to read, the library is the one asked for, else the default", async () => {
    for (const [start, args] of STARTS) {
      const empty = await app(`empty-${start}`, {});
      const stdout = await init(empty, args);
      expect(await libraryOf(empty)).toBe("shadcn-upstream");
      expect(stdout).not.toContain("No UI library detected");
      // Nothing here to match, so nothing to set up for.
      expect(stdout).not.toMatch(/sets? Velloo up/i);

      await init(empty, { ...args, library: "none", designFolder: "second" });
      expect(await libraryOf(empty, "second")).toBe("none");
    }
  });

  test("an app in a subfolder is read where it is, and recorded as the app", async () => {
    const repo = await app("repo", {
      "web/package.json": pkg({ "@mui/material": "^6.0.0" }),
      "web/components/ui/button.tsx": "export const Button = () => null;\n",
    });
    const stdout = await init(repo, { start: "blank" });
    const written = await config(repo);
    expect(written.libraries.default?.id).toBe("mui");
    expect(written.hostApp?.root).toBe("../web");
    expect(stdout).toContain("set Velloo up for this app");
  });

  test("--scan-dir names the app when the repo holds more than one", async () => {
    const repo = await app("two", {
      "web/package.json": pkg({ "@mui/material": "^6.0.0" }),
      "admin/package.json": pkg({ antd: "^5.0.0" }),
    });
    await init(repo, { start: "blank", scanDir: "admin" });
    const written = await config(repo);
    expect(written.libraries.default?.id).toBe("antd");
    expect(written.hostApp?.root).toBe("../admin");
  });
});

describe("what init says it could and could not import", () => {
  const LAYOUT = `import { Space_Grotesk } from "next/font/google";
    const sans = Space_Grotesk({ variable: "--font-sans" });`;

  const tailwindApp = (name: string, extend: string, css: string) =>
    app(name, {
      "package.json": pkg({ next: "15.0.0" }, { tailwindcss: "^3.4.0" }),
      "components.json": JSON.stringify({
        style: "new-york",
        tailwind: { css: "app/globals.css" },
      }),
      "app/globals.css": css,
      "app/layout.tsx": LAYOUT,
      "tailwind.config.ts": `export default { theme: { extend: {
        colors: { primary: { DEFAULT: "hsl(var(--primary))" } },
        fontFamily: { display: ["var(--font-sans)", "Impact"], sans: ["var(--font-sans)", "sans-serif"] },
        ${extend}
      } } };`,
    });

  const BOTH_SCHEMES = ":root { --primary: 64 92% 52%; }\n.dark { --primary: 64 92% 40%; }\n";
  const line = (stdout: string, starts: string) =>
    stdout
      .split("\n")
      .find((l) => l.trim().startsWith(starts))
      ?.trim();

  test("a family that fills two roles is named once", async () => {
    const dir = await tailwindApp("one-family", "", BOTH_SCHEMES);
    const stdout = await init(dir, { start: "blank" });
    expect(line(stdout, "Fonts:")).toBe("Fonts: Space Grotesk — from your app's font loader.");
    const theme = ThemeSchema.parse(
      JSON.parse(await readFile(join(dir, "velloo/theme/default.json"), "utf8")),
    );
    expect(theme.typography.fontFamily?.sans).toStartWith('"Space Grotesk", ');
    expect(theme.typography.fontFamily?.display).toStartWith('"Space Grotesk", ');
  });

  test("an import that carried everything says nothing was left", async () => {
    const dir = await tailwindApp("all-carried", "", BOTH_SCHEMES);
    const stdout = await init(dir, { start: "blank" });
    expect(stdout).toContain(`Imported your theme from ${join("app", "globals.css")}.`);
    expect(stdout).not.toContain("Left for setup");
  });

  test("Tailwind settings with no theme token are counted and named, not listed as the import names them", async () => {
    const one = await tailwindApp("one", 'letterSpacing: { machine: "0.22em" },', BOTH_SCHEMES);
    expect(line(await init(one, { start: "blank" }), "Left for setup:")).toBe(
      "Left for setup: 1 Tailwind setting with no theme token (letterSpacing).",
    );

    const two = await tailwindApp(
      "two",
      'letterSpacing: { machine: "0.22em" }, transitionTimingFunction: { snap: "cubic-bezier(0.2, 0, 0, 1)" },',
      BOTH_SCHEMES,
    );
    expect(line(await init(two, { start: "blank" }), "Left for setup:")).toBe(
      "Left for setup: 2 Tailwind settings with no theme token (letterSpacing, transitionTimingFunction).",
    );
  });

  test("what else was left comes first, and the settings close the list", async () => {
    const dir = await tailwindApp(
      "light-only",
      'letterSpacing: { machine: "0.22em" },',
      ":root { --primary: 64 92% 52%; }\n",
    );
    const left = line(await init(dir, { start: "blank" }), "Left for setup:") ?? "";
    const parts = left.replace(/^Left for setup: |\.$/g, "").split("; ");
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.at(-1)).toBe("1 Tailwind setting with no theme token (letterSpacing)");
    expect(left).not.toContain("`");
  });

  test("a stylesheet that was found and holds no tokens is said plainly, with the way out", async () => {
    const dir = await app("tokenless", {
      "package.json": pkg({}, { tailwindcss: "^4.0.0" }),
      "components.json": JSON.stringify({ style: "new-york", tailwind: { css: "src/app.css" } }),
      "src/app.css": "@import 'tailwindcss';\n@import '@acme/design-tokens/theme.css';\n",
    });
    const stdout = await init(dir, { start: "blank" });
    const sheet = join("src", "app.css");
    expect(stdout).toContain(
      `Found ${sheet}, but no theme tokens in it or in the stylesheets it imports — your design starts on a preset instead.`,
    );
    // Both ways out: a stylesheet elsewhere, or a theme that lives in JavaScript.
    expect(line(stdout, "Ask your agent to")).toContain("`import_theme`");
    expect(line(stdout, "Ask your agent to")).toContain("`set_theme`");
    expect(line(stdout, "Theme ")).toBe(
      `Theme       Zinc (neutral) preset — no tokens found in ${sheet}`,
    );
    expect(stdout).not.toContain("Imported your theme");
  });

  test("a Mantine app is not told its dark palette is left, whatever its stylesheet lacks", async () => {
    const dir = await app("mantine-light-sheet", {
      "package.json": pkg({ "@mantine/core": "^8.0.0" }, { tailwindcss: "^4.0.0" }),
      // Light only: no `.dark` block.
      "src/index.css": ":root { --primary: #0b5fff; --font-sans: 'Fancy Grotesk', sans-serif; }\n",
      "src/theme.ts": `import { createTheme } from "@mantine/core";
        export const theme = createTheme({ primaryColor: "teal" });`,
    });
    const stdout = await init(dir, { start: "blank" });
    expect(stdout).toContain(`Imported your theme from ${join("src", "theme.ts")}.`);
    expect(stdout).not.toContain("a dark palette");
    const theme = ThemeSchema.parse(
      JSON.parse(await readFile(join(dir, "velloo/theme/default.json"), "utf8")),
    );
    expect(Object.keys(theme.colorsDark ?? {}).length).toBeGreaterThan(0);
  });

  test("on a library's defaults, the fonts and what is left are said too", async () => {
    const dir = await app("mantine-defaults", {
      "package.json": pkg({ "@mantine/core": "^8.0.0", next: "15.0.0" }, { tailwindcss: "^4.0.0" }),
      // Its face is named for headings only, which leaves the body's to setup.
      "app/globals.css": ":root { --primary: #0b5fff; --font-heading: var(--font-grotesk); }\n",
      "app/layout.tsx": `import { Space_Grotesk } from "next/font/google";
        const sans = Space_Grotesk({ variable: "--font-grotesk" });`,
    });
    const stdout = await init(dir, { start: "blank" });
    expect(line(stdout, "Your app sets no Mantine theme")).toBeDefined();
    expect(line(stdout, "Fonts:")).toBe("Fonts: Space Grotesk — from your app's font loader.");
    expect(line(stdout, "Left for setup:")).toBe("Left for setup: a body font (sans).");
    expect(line(stdout, "Imported your theme")).toBeUndefined();
  });

  test("with nothing imported, none of it is said", async () => {
    const dir = await app("unthemed", { "package.json": pkg({}) });
    const stdout = await init(dir, { start: "blank" });
    for (const said of [
      "Imported your theme",
      "Fonts:",
      "Left for setup",
      "sets no",
      "no theme tokens",
    ])
      expect(stdout).not.toContain(said);
    expect(stdout).toMatch(/Theme\s+Zinc \(neutral\)\n/);
  });
});

describe("the welcome sample in an app", () => {
  const SAMPLES: [string, Record<string, string>, LibraryId][] = [
    [
      "Mantine, which has no adapter",
      { "package.json": pkg({ "@mantine/core": "^8.0.0" }) },
      "none",
    ],
    ["Material UI", { "package.json": pkg({ "@mui/material": "^6.0.0" }) }, "mui"],
    // No library of the app's to show it in: the one it was made with.
    ["no UI library", { "package.json": pkg({}) }, "shadcn-upstream"],
    ["nothing at all", {}, "shadcn-upstream"],
  ];

  for (const [what, files, expected] of SAMPLES) {
    test(`in a directory with ${what} it is composed with ${expected}`, async () => {
      const dir = await app("sample", files);
      const stdout = await init(dir, { start: "sample" });
      expect(await libraryOf(dir)).toBe(expected);
      const screens = await readdir(join(dir, "velloo", "screens"));
      expect(screens.filter((file) => file.endsWith(".json")).length).toBeGreaterThan(0);
      // It keeps its own theme and matches no app, so setup is not a step.
      const written = await config(dir);
      expect(written.themeSource).toEqual({ kind: "preset" });
      expect(stdout).not.toMatch(/set Velloo up/i);
      expect(stdout).not.toContain("Imported your theme");
    });
  }

  test("an app's library pinned with --library is kept", async () => {
    const dir = await app("pinned-sample", { "package.json": pkg({ "@mui/material": "^6.0.0" }) });
    await init(dir, { start: "sample", library: "chakra" });
    expect(await libraryOf(dir)).toBe("chakra");
  });
});

describe("where init records the theme came from", () => {
  test("a stylesheet, with the sheets it imports and the files that set its fonts", async () => {
    const dir = await app("from-sheet", {
      "package.json": pkg({ next: "15.0.0" }, { tailwindcss: "^3.4.0" }),
      "components.json": JSON.stringify({
        style: "new-york",
        tailwind: { css: "app/globals.css" },
      }),
      "app/globals.css": "@import './tokens.css';\n.dark { --primary: 64 92% 40%; }\n",
      "app/tokens.css": ":root { --primary: 64 92% 52%; --font-sans: var(--font-grotesk); }\n",
      "app/layout.tsx": `import { Space_Grotesk } from "next/font/google";
        const sans = Space_Grotesk({ variable: "--font-grotesk" });`,
      "tailwind.config.ts": "export default { theme: { extend: {} } };",
    });
    await init(dir, { start: "blank" });
    expect((await config(dir)).themeSource).toEqual({
      kind: "stylesheet",
      files: ["app/globals.css", "app/tokens.css", "tailwind.config.ts", "app/layout.tsx"],
    });
  });

  test("a Mantine theme, and the stylesheet under it", async () => {
    const dir = await app("from-mantine", {
      "package.json": pkg({ "@mantine/core": "^8.0.0" }),
      "src/theme.ts": `import { createTheme } from "@mantine/core";
        export const theme = createTheme({ primaryColor: "teal" });`,
    });
    await init(dir, { start: "blank" });
    expect((await config(dir)).themeSource).toEqual({ kind: "mantine", files: ["src/theme.ts"] });
  });

  test("a MUI theme", async () => {
    const dir = await app("from-mui", {
      "package.json": pkg({ "@mui/material": "^6.0.0" }),
      "src/main.tsx": `import { ThemeProvider, createTheme } from "@mui/material/styles";
        root.render(<ThemeProvider theme={createTheme({ palette: { primary: { main: "#0b5fff" } } })} />);`,
    });
    await init(dir, { start: "blank" });
    expect((await config(dir)).themeSource).toEqual({ kind: "mui", files: ["src/main.tsx"] });
  });

  test("a library's own defaults, for an app that sets no theme", async () => {
    const dir = await app("from-defaults", { "package.json": pkg({ "@mantine/core": "^8.0.0" }) });
    await init(dir, { start: "blank" });
    expect((await config(dir)).themeSource).toEqual({
      kind: "library-defaults",
      library: "Mantine",
    });
  });

  test("nothing of the app's: a preset", async () => {
    const dir = await app("from-nothing", { "package.json": pkg({}) });
    await init(dir, { start: "blank" });
    expect((await config(dir)).themeSource).toEqual({ kind: "preset" });
  });
});
