import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as clack from "@clack/prompts";
import { ThemeSchema } from "@velloo/schema";
import { scaffoldDesignFolder } from "@velloo/server/testing";

/**
 * "Re-import the theme" on a design that already exists — for when the app's
 * look moved after init. It reads the app the way init does, so a stylesheet
 * that is only an entry point is followed to the sheet that holds the tokens,
 * and it overwrites `theme/default.json` only on a yes.
 */

let answer: boolean | symbol = true;
const said: string[] = [];
const asked: string[] = [];

mock.module("@clack/prompts", () => ({
  ...clack,
  confirm: async (opts: { message: string }) => {
    asked.push(opts.message);
    return answer;
  },
  log: {
    ...clack.log,
    info: (message: string) => said.push(message),
    warn: (message: string) => said.push(message),
    success: (message: string) => said.push(message),
  },
  isCancel: (value: unknown) => typeof value === "symbol",
}));

const { runThemeReimport } = await import("../existing-folder.ts");

let app: string;
let folder: string;

beforeEach(async () => {
  const scaffolded = await scaffoldDesignFolder({ label: "reimport", nested: true });
  folder = scaffolded.root;
  app = dirname(folder);
  answer = true;
  said.length = 0;
  asked.length = 0;
});
afterEach(async () => {
  await rm(app, { recursive: true, force: true });
});

async function write(rel: string, body: string): Promise<void> {
  await mkdir(dirname(join(app, rel)), { recursive: true });
  await writeFile(join(app, rel), body, "utf8");
}

const theme = async () =>
  ThemeSchema.parse(JSON.parse(await readFile(join(folder, "theme/default.json"), "utf8")));

/** A shadcn app whose `components.json` names an entry stylesheet that imports its tokens. */
async function splitThemeApp(): Promise<void> {
  await write("package.json", JSON.stringify({ dependencies: { react: "^19.0.0" } }));
  await write(
    "components.json",
    JSON.stringify({ style: "new-york", tailwind: { css: "src/styles/index.css" } }),
  );
  await write("src/styles/index.css", "@import 'tailwindcss';\n@import './theme.css';\n");
  await write(
    "src/styles/theme.css",
    ":root{--primary: oklch(0.208 0.042 265.755);--radius: 0.625rem;}\n",
  );
}

describe("re-importing the app's theme", () => {
  test("tokens in a sheet the stylesheet imports are found, and replace the theme on a yes", async () => {
    await splitThemeApp();
    await runThemeReimport(folder, app);

    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("Replace theme/default.json");
    const imported = await theme();
    expect(JSON.stringify(imported.colors.primary)).toContain("oklch(0.208 0.042 265.755)");
    expect(imported.radius.md).toBe("0.625rem");
    expect(said.at(-1)).toContain("Theme re-imported from");
  });

  test("declining leaves the theme exactly as it was", async () => {
    await splitThemeApp();
    const before = await readFile(join(folder, "theme/default.json"), "utf8");
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      for (const no of [false, Symbol("cancel")]) {
        answer = no;
        await runThemeReimport(folder, app);
        expect(await readFile(join(folder, "theme/default.json"), "utf8")).toBe(before);
      }
      expect(log.mock.calls.flat().join("\n")).toContain("Nothing changed.");
    } finally {
      log.mockRestore();
    }
  });

  test("a MUI app's createTheme is what is offered, ahead of its stylesheet", async () => {
    await write(
      "package.json",
      JSON.stringify({ dependencies: { react: "^19.0.0", "@mui/material": "^6.0.0" } }),
    );
    await write("src/index.css", ":root{--primary: #ff0000;}\n");
    await write(
      "src/theme.ts",
      `import { createTheme } from "@mui/material/styles";
       export default createTheme({ palette: { primary: { main: "#0b5fff" } } });`,
    );
    await runThemeReimport(folder, app);
    expect(JSON.stringify((await theme()).colors.primary)).toContain("#0b5fff");
  });

  test("with nothing to import it says so, asks nothing and writes nothing", async () => {
    await write("package.json", JSON.stringify({ dependencies: { react: "^19.0.0" } }));
    const before = await readFile(join(folder, "theme/default.json"), "utf8");
    await runThemeReimport(folder, app);
    expect(asked).toEqual([]);
    expect(said.join("\n")).toContain("Couldn't find a theme to import");
    expect(await readFile(join(folder, "theme/default.json"), "utf8")).toBe(before);
  });
});
