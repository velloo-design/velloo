import { readFile } from "node:fs/promises";
import { extname, isAbsolute, resolve } from "node:path";
import { isCancel, select } from "@clack/prompts";
import { closePooledBrowser, renderScreen, screenshot } from "@velloo/renderer";
import { ScreenSchema, type Viewport } from "@velloo/schema";
import { registryForScreen, renderPassForScreen, writeText } from "@velloo/server";
import { defineCommand } from "citty";
import { withAssetServer } from "../asset-server.ts";
import { captureWithBrowserSetup } from "../browser-setup.ts";
import { loadPipeline } from "../ci/render.ts";
import { DESIGN_ARG_DESCRIPTION, pickScreen, resolveDesign } from "../design.ts";
import { findDesignConfig } from "../design-config.ts";
import { fail } from "../fail.ts";
import { createProgress } from "../progress.ts";

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
      description: DESIGN_ARG_DESCRIPTION,
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
      // The folder still resolves in manifest terms: an explicit --folder may
      // be a velloo.json project name; otherwise walk up from the screen file
      // to its containing design folder (blind ../.. broke on nested paths and
      // failed cryptically inside the pipeline).
      if (args.folder) {
        folder = await resolveDesign(args.folder, "render", { designFlag: "--folder" });
      } else {
        const found = await findDesignConfig(screenPath);
        if (!found) {
          fail(
            "render",
            `${screenPath} is not inside a velloo design folder (no .design/config.json above it). Pass --folder with a project name or a path.`,
          );
        }
        folder = found.folder;
      }
    } else {
      folder = await resolveDesign(args.folder, "render", { designFlag: "--folder" });
      screenPath = (await pickScreen(folder, screenArg, interactive, "render")).path;
    }

    const screen = ScreenSchema.parse(JSON.parse(await readFile(screenPath, "utf8")));

    const viewport: Viewport = {
      w: args.w ? Number(args.w) : 1440,
      h: args.h ? Number(args.h) : 900,
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
    if (out !== ".html" && out !== ".png") {
      fail("render", `unsupported output extension ${JSON.stringify(out)}. Use .html or .png.`);
    }

    const progress = createProgress();
    progress.start("preparing render");
    try {
      // Reuse the same headless pipeline as `publish`: the JIT carries
      // `extraThemeBlock` (so palette/font utilities compile), and the render gets
      // the folder's custom.css — both of which the old hand-rolled path dropped,
      // making `velloo render` diverge from the canvas.
      const pipeline = await loadPipeline(folder);
      const { design, config, providers, defaultProvider, snapshotCss } = pipeline;
      const theme = design.theme;
      const registry = registryForScreen(
        screen,
        providers,
        defaultProvider,
        config.extensions ?? {},
      );
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

      if (out === ".html") {
        progress.step("rendering HTML");
        // Root-relative `/assets/…` links stay as-is (no baseHref) — an .html
        // written to disk has no live server to resolve an ephemeral origin.
        await writeText(outPath, await renderHtml());
        progress.succeed("rendered HTML");
        console.log(`velloo render: wrote ${outPath} (screen=${screen.id})`);
        return;
      }

      progress.step("rendering screen");
      // Serve the folder's assets/ so `/assets/…` resolve during capture.
      await withAssetServer(folder, null, async (baseHref) => {
        const html = await renderHtml(baseHref);
        try {
          await captureWithBrowserSetup("render", async () => {
            progress.step("capturing PNG");
            try {
              await screenshot({ html, viewport, outPath });
            } catch (error) {
              // Stop the spinner before the browser helper prints or prompts,
              // then let its optional retry start a fresh live line.
              progress.fail("PNG capture failed");
              throw error;
            }
          });
        } finally {
          // One-shot process: release the pooled Chromium or the open browser
          // connection keeps the CLI alive after the file is written.
          await closePooledBrowser();
        }
      });
      progress.succeed("rendered PNG");
      console.log(`velloo render: wrote ${outPath} (screen=${screen.id})`);
    } catch (error) {
      progress.fail("render failed");
      throw error;
    }
  },
});
