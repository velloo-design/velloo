import { extname, isAbsolute, resolve } from "node:path";
import { isCancel, select } from "@clack/prompts";
import { closePooledBrowser } from "@velloo/renderer";
import type { Viewport } from "@velloo/schema";
import {
  type ExportFormat,
  type ExportMode,
  type ExportPipeline,
  exportBoardHtml,
  exportBoardPdf,
  exportBoardPng,
  exportFilename,
  exportFrameHtml,
  exportFramePdf,
  exportFramePng,
  exportScreenHtml,
  exportScreenPdf,
  exportScreenPng,
  findFrame,
  hostFilesFetch,
  screensForExportTarget,
  writeText,
} from "@velloo/server";
import { defineCommand } from "citty";
import { LIVE_BUNDLE_PATH, withAssetServer } from "../asset-server.ts";
import { captureWithBrowserSetup } from "../browser-setup.ts";
import { DESIGN_ARG_DESCRIPTION, resolveDesign } from "../design.ts";
import { fail } from "../fail.ts";
import { confirmRenderFailures } from "../preflight-gate.ts";
import { loadPipeline } from "../render-pipeline.ts";

/**
 * `velloo export` — the user-facing artifact command over the shared
 * export core: screens, frames, and boards → PNG / PDF / standalone HTML,
 * format picked by the output extension. `velloo render` stays the dev
 * screen-level primitive (screen → html/png at a viewport, no frame/board
 * semantics); export is what you reach for to send a design around.
 */

type TargetKind = "screen" | "frame" | "board";

export default defineCommand({
  meta: {
    name: "export",
    description:
      "Export a screen, frame, or board as PNG, PDF, or standalone HTML (format = --to extension)",
  },
  args: {
    target: {
      type: "positional",
      required: false,
      description: "Screen, frame, or board id. Omit to pick interactively.",
    },
    design: {
      type: "string",
      description: DESIGN_ARG_DESCRIPTION,
    },
    to: {
      type: "string",
      description:
        "Output path; extension picks the format (.png | .pdf | .html). Default: ./<target>.png",
    },
    mode: {
      type: "string",
      description:
        "light (default) | dark | compare (side-by-side light|dark; PNG, non-board only)",
    },
    scale: {
      type: "string",
      description: "PNG raster density (0.25–3; default 1; 2 = retina)",
    },
    theme: {
      type: "string",
      description: "Named theme to render with (default: the board's pin, else the folder default)",
    },
    w: { type: "string", description: "Viewport width for screen targets (default: first preset)" },
    h: {
      type: "string",
      description: "Viewport height for screen targets (default: first preset)",
    },
    yes: {
      type: "boolean",
      description:
        "Export even when a component fails to render (required without an interactive terminal)",
    },
  },
  async run({ args }) {
    const folder = await resolveDesign(args.design, "export", { designFlag: "--design" });
    const pipeline = await loadPipeline(folder);
    const design = pipeline.design;

    const mode = (args.mode ?? "light") as ExportMode;
    if (!["light", "dark", "compare"].includes(mode)) {
      fail("export", `--mode must be light, dark, or compare — got '${args.mode}'`);
    }
    const scale = args.scale ? Number(args.scale) : 1;
    if (!Number.isFinite(scale) || scale < 0.25 || scale > 3) {
      fail("export", `--scale must be between 0.25 and 3 — got '${args.scale}'`);
    }

    // Resolve the target: screen id, frame id, or board id (checked in that
    // order — the id spaces don't collide in practice; a picker covers the rest).
    let targetId = args.target;
    if (!targetId) {
      const options = [
        ...[...design.boards.values()].map((b) => ({
          value: b.id,
          label: b.name,
          hint: `board · ${b.frames.length} frame${b.frames.length === 1 ? "" : "s"}`,
        })),
        ...[...design.screens.values()].map((s) => ({
          value: s.id,
          label: s.name || s.id,
          hint: "screen",
        })),
      ];
      if (options.length === 0) fail("export", `nothing to export in ${folder}.`);
      if (!process.stdin.isTTY) {
        fail(
          "export",
          `pass a target: ${options.map((o) => o.value).join(", ")} (boards and screens; frame ids work too)`,
        );
      }
      const chosen = await select<string>({ message: "Export what?", options });
      if (isCancel(chosen)) fail("export", "cancelled.");
      targetId = chosen as string;
    }

    const screen = design.screens.get(targetId);
    const framed = screen ? null : findFrame(design, targetId);
    const board = screen || framed ? null : design.boards.get(targetId);
    const kind: TargetKind | null = screen ? "screen" : framed ? "frame" : board ? "board" : null;
    if (!kind) {
      fail(
        "export",
        `no screen, frame, or board with id "${targetId}" in ${folder}. Boards: ${[...design.boards.keys()].join(", ") || "(none)"}; screens: ${[...design.screens.keys()].join(", ") || "(none)"}.`,
      );
    }

    const name =
      screen?.name ||
      framed?.frame.label ||
      (framed ? design.screens.get(framed.frame.screen)?.name : undefined) ||
      board?.name ||
      targetId;
    const outPath = args.to
      ? isAbsolute(args.to)
        ? args.to
        : resolve(args.to)
      : resolve(exportFilename(name, "png"));
    const ext = extname(outPath).toLowerCase().slice(1);
    if (ext !== "png" && ext !== "pdf" && ext !== "html") {
      fail("export", `unsupported output extension ".${ext}" — use .png, .pdf, or .html.`);
    }
    const format = ext as ExportFormat;
    if (mode === "compare" && (format !== "png" || kind === "board")) {
      fail("export", 'mode "compare" is PNG-only and not available for boards.');
    }

    const preset = design.config.viewportPresets[0] ?? { name: "default", w: 1440, h: 900 };
    const viewport: Viewport = {
      w: args.w ? Number(args.w) : preset.w,
      h: args.h ? Number(args.h) : preset.h,
    };

    // Everything above only validated the request. Check the design itself
    // before the browser starts and the file gets written.
    await confirmRenderFailures(
      "export",
      { folder: design, providers: pipeline.providers, defaultProvider: pipeline.defaultProvider },
      screensForExportTarget(design, kind, targetId),
      args.yes === true,
    );

    const opts = { mode, scale, ...(args.theme ? { theme: args.theme } : {}) };
    let assetOrigin: string | undefined;
    // Standalone HTML has no server to fetch a live module from, so it never
    // builds one — nor reports components that failed to compile into it.
    const live = format === "html" ? null : await pipeline.liveModule();
    // What the daemon's export route supplies and a one-shot CLI otherwise
    // doesn't: the client mount for the app's own components, and the
    // live-island bundle. Without them a CLI PNG shows proxies and static
    // islands where the canvas shows the real thing. Standalone HTML declines
    // the mount on its own.
    const p: ExportPipeline = {
      folder: design,
      providers: pipeline.providers,
      defaultProvider: pipeline.defaultProvider,
      snapshotCss: async () => pipeline.snapshotCss,
      assetOrigin: () => assetOrigin,
      canvasBundleFor: pipeline.capture.forScreen,
      appCss: pipeline.capture.appCss,
      liveBundleUrl: () => (live?.code ? LIVE_BUNDLE_PATH : undefined),
    };

    const produce = async (): Promise<{ bytes: Uint8Array | string; warnings: string[] }> => {
      if (kind === "screen" && screen) {
        if (format === "html") {
          const out = await exportScreenHtml(p, screen, {
            dark: mode === "dark",
            ...(args.theme ? { theme: args.theme } : {}),
            viewport,
          });
          return { bytes: out.html, warnings: out.warnings };
        }
        if (format === "pdf") {
          return { bytes: await exportScreenPdf(p, screen, { ...opts, viewport }), warnings: [] };
        }
        return { bytes: await exportScreenPng(p, screen, { ...opts, viewport }), warnings: [] };
      }
      if (kind === "frame" && framed) {
        if (format === "html") {
          const out = await exportFrameHtml(p, framed.board, framed.frame, opts);
          return { bytes: out.html, warnings: out.warnings };
        }
        const bytes =
          format === "pdf"
            ? await exportFramePdf(p, framed.board, framed.frame, opts)
            : await exportFramePng(p, framed.board, framed.frame, opts);
        return { bytes, warnings: [] };
      }
      if (!board) fail("export", "internal: target resolution failed");
      if (format === "html") {
        const out = await exportBoardHtml(p, board, opts);
        return { bytes: out.html, warnings: out.warnings };
      }
      const bytes =
        format === "pdf"
          ? await exportBoardPdf(p, board, opts)
          : await exportBoardPng(p, board, opts);
      return { bytes, warnings: [] };
    };

    let result: { bytes: Uint8Array | string; warnings: string[] } | undefined;
    try {
      if (format === "html") {
        // Standalone HTML needs no browser and no asset server — everything inlines.
        result = await produce();
      } else {
        await withAssetServer(
          folder,
          live?.code ?? null,
          async (baseHref) => {
            assetOrigin = baseHref;
            await captureWithBrowserSetup("export", async () => {
              result = await produce();
            });
          },
          {
            bundle: pipeline.capture.serve,
            host: hostFilesFetch(() => folder),
          },
        );
      }
    } finally {
      await closePooledBrowser();
    }
    if (!result) fail("export", "capture produced no output");

    if (typeof result.bytes === "string") await writeText(outPath, result.bytes);
    else await Bun.write(outPath, result.bytes);
    console.log(`velloo export: wrote ${outPath} (${kind}=${targetId}, mode=${mode})`);
    for (const warning of [...(live?.warnings ?? []), ...result.warnings]) {
      console.log(`  note: ${warning}`);
    }
  },
});
