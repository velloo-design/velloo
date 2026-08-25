import { readFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, resolve } from "node:path";
import { confirm, isCancel, select } from "@clack/prompts";
import {
  BrowserMissingError,
  CHROMIUM_INSTALL_ARGV,
  CHROMIUM_INSTALL_CMD,
  closePooledBrowser,
  renderScreen,
  screenshot,
} from "@velloo/renderer";
import { ScreenSchema, type Viewport } from "@velloo/schema";
import { registryForScreen, renderPassForScreen, writeText } from "@velloo/server";
import { defineCommand } from "citty";
import { withAssetServer } from "../asset-server.ts";
import { loadPipeline } from "../ci/render.ts";
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

    const screen = ScreenSchema.parse(JSON.parse(await readFile(screenPath, "utf8")));

    const viewport: Viewport = {
      w: args.w ? Number(args.w) : 1440,
      h: args.h ? Number(args.h) : 900,
    };

    // Reuse the same headless pipeline as `velloo ci`/`publish`: the JIT carries
    // `extraThemeBlock` (so palette/font utilities compile), and the render gets
    // the folder's custom.css — both of which the old hand-rolled path dropped,
    // making `velloo render` diverge from the canvas.
    const pipeline = await loadPipeline(folder);
    const { design, config, providers, defaultProvider, snapshotCss } = pipeline;
    const theme = design.theme;
    const registry = registryForScreen(screen, providers, defaultProvider, config.extensions ?? {});
    const renderPass = renderPassForScreen(screen, providers, defaultProvider, theme);
    const renderHtml = async (baseHref?: string): Promise<string> => {
      const { html } = await renderScreen(screen, theme, {
        viewport,
        snapshotCss,
        registry,
        snippets: design.snippets,
        renderPass,
        customCss: design.customCss,
        ...(baseHref ? { baseHref } : {}),
      });
      return html;
    };

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
      // Root-relative `/assets/…` links stay as-is (no baseHref) — an .html
      // written to disk has no live server to resolve an ephemeral origin.
      await writeText(outPath, await renderHtml());
      console.log(`velloo render: wrote ${outPath} (screen=${screen.id})`);
      return;
    }

    if (out === ".png") {
      // Serve the folder's assets/ so `/assets/…` resolve during capture.
      await withAssetServer(folder, null, async (baseHref) => {
        const html = await renderHtml(baseHref);
        try {
          await captureWithBrowserSetup(() => screenshot({ html, viewport, outPath }));
        } finally {
          // One-shot process: release the pooled Chromium or the open browser
          // connection keeps the CLI alive after the file is written.
          await closePooledBrowser();
        }
      });
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
    const code = await Bun.spawn([...CHROMIUM_INSTALL_ARGV], {
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    }).exited;
    if (code !== 0) fail("render", "chromium install failed — see the output above.");
  }
  await capture();
}
