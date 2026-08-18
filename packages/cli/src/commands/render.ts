import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { confirm, isCancel, select } from "@clack/prompts";
import {
  BrowserMissingError,
  CHROMIUM_INSTALL_CMD,
  renderScreen,
  screenshot,
} from "@velloo/renderer";
import {
  ConfigSchema,
  ScreenSchema,
  type Snippet,
  SnippetSchema,
  ThemeSchema,
  type Viewport,
} from "@velloo/schema";
import { migrateConfig, resolveProviders, TailwindJit, writeText } from "@velloo/server";
import { defineCommand } from "citty";
import { fail } from "../fail.ts";
import { pickScreen, resolveDesignFolder } from "../folder.ts";

export default defineCommand({
  meta: {
    name: "render",
    description: "dev: render a screen headless to .html or .png",
  },
  args: {
    screen: {
      type: "positional",
      required: false,
      description: "Screen id, or a path to a screen JSON. Omit to pick interactively.",
    },
    folder: {
      type: "string",
      description: "Design folder (default: ./velloo)",
    },
    to: {
      type: "string",
      description:
        "Output path; extension picks the format (.html | .png). Default: ./<screen>.html",
    },
    w: { type: "string", description: "Viewport width in px (default: 1440)" },
    h: { type: "string", description: "Viewport height in px (default: 900)" },
  },
  async run({ args }) {
    const interactive = Boolean(process.stdin.isTTY);

    // A path-shaped arg (e.g. design/screens/x.json) keeps working and pins the
    // folder; otherwise resolve the folder (default ./velloo) and pick a screen.
    const screenArg = args.screen;
    const looksLikePath = !!screenArg && (screenArg.includes("/") || screenArg.endsWith(".json"));

    let folder: string;
    let screenPath: string;
    if (looksLikePath && screenArg) {
      screenPath = resolve(screenArg);
      folder = args.folder ? resolve(args.folder) : dirname(dirname(screenPath));
    } else {
      folder = await resolveDesignFolder(args.folder, "render");
      screenPath = (await pickScreen(folder, screenArg, interactive, "render")).path;
    }

    const themePath = resolve(folder, "theme", "default.json");
    const configPath = resolve(folder, ".design", "config.json");

    const [screenJson, themeJson, configJson] = await Promise.all([
      readFile(screenPath, "utf8").then(JSON.parse),
      readFile(themePath, "utf8").then(JSON.parse),
      readFile(configPath, "utf8").then(JSON.parse),
    ]);
    const screen = ScreenSchema.parse(screenJson);
    const theme = ThemeSchema.parse(themeJson);
    const config = migrateConfig(ConfigSchema.parse(configJson));

    const viewport: Viewport = {
      w: args.w ? Number(args.w) : 1440,
      h: args.h ? Number(args.h) : 900,
    };

    const snippets = new Map<string, Snippet>();
    const snippetFiles = (await readdir(join(folder, "snippets")).catch(() => [])).filter((f) =>
      f.endsWith(".json"),
    );
    for (const file of snippetFiles) {
      const raw = await readFile(join(folder, "snippets", file), "utf8").then(JSON.parse);
      const snippet = SnippetSchema.parse(raw);
      snippets.set(snippet.id, snippet);
    }

    const { providers, defaultProvider } = await resolveProviders(config, folder);
    const screenProvider = screen.library
      ? (providers[screen.library] ?? defaultProvider)
      : defaultProvider;
    const jit = new TailwindJit(Object.values(providers), join(folder, "screens"));
    const snapshotCss = await jit.build();
    const { html } = await renderScreen(screen, theme, {
      viewport,
      snapshotCss,
      registry: screenProvider.registry,
      snippets,
    });

    // Output: explicit --to wins; otherwise interactively choose the format and
    // write ./<screen>.<ext> (HTML needs no browser, so it's the non-TTY default).
    let outPath: string;
    if (args.to) {
      outPath = isAbsolute(args.to) ? args.to : resolve(args.to);
    } else {
      let ext = "html";
      if (interactive) {
        const fmt = await select<"html" | "png">({
          message: "Output format?",
          options: [
            { value: "html", label: "HTML", hint: "no browser needed" },
            { value: "png", label: "PNG", hint: "screenshot (needs a headless browser)" },
          ],
        });
        if (isCancel(fmt)) fail("render", "cancelled.");
        ext = fmt;
      }
      outPath = resolve(`${screen.id}.${ext}`);
    }
    const out = extname(outPath).toLowerCase();

    if (out === ".html") {
      await writeText(outPath, html);
      console.log(`velloo render: wrote ${outPath} (screen=${screen.id})`);
      return;
    }

    if (out === ".png") {
      await captureWithBrowserSetup(() => screenshot({ html, viewport, outPath }));
      console.log(`velloo render: wrote ${outPath} (screen=${screen.id})`);
      return;
    }

    fail("render", `unsupported output extension ${JSON.stringify(out)}. Use .html or .png.`);
  },
});

/**
 * Run a screenshot; if the headless browser is missing, offer to install it
 * (interactive shells only) and retry once. Non-interactive shells get the
 * actionable hint and a non-zero exit so CI fails loudly rather than hanging
 * on a prompt.
 */
async function captureWithBrowserSetup(capture: () => Promise<unknown>): Promise<void> {
  try {
    await capture();
    return;
  } catch (e) {
    if (!(e instanceof BrowserMissingError)) throw e;
    if (!process.stdin.isTTY) fail("render", e.message);
    const proceed = await confirm({
      message: `Chromium isn't installed. Run \`${CHROMIUM_INSTALL_CMD}\` now? (~150MB, one-time)`,
      initialValue: true,
    });
    if (isCancel(proceed) || !proceed) fail("render", e.message);
    const code = await Bun.spawn(["bunx", "playwright", "install", "chromium"], {
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    }).exited;
    if (code !== 0) fail("render", "chromium install failed — see the output above.");
  }
  await capture();
}
