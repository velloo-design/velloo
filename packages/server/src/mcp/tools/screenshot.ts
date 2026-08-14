import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { renderScreen, screenshotBuffer, screenshotCompareBuffer } from "@velloo/renderer";
import type { Screen, Viewport } from "@velloo/schema";
import { z } from "zod";
import type { MutationContext } from "../../mutations/index.ts";
import type { TailwindJit } from "../../styles/tailwind-jit.ts";

type McpResult = {
  content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[];
  isError?: true;
};

function errorResult(text: string): McpResult {
  return { isError: true, content: [{ type: "text", text }] };
}

function playwrightMissingMessage(msg: string): string {
  return `screenshot: Playwright is not installed. Run \`bunx playwright install chromium\`. Underlying error: ${msg}`;
}

function defaultViewport(folder: {
  config: { viewportPresets: Array<{ name: string; w: number; h: number }> };
}): Viewport {
  // Prefer Desktop, fall back to first preset.
  const presets = folder.config.viewportPresets;
  const desktop = presets.find((p) => p.name.toLowerCase().includes("desktop"));
  const pick = desktop ?? presets[0] ?? { w: 1440, h: 900 };
  return { w: pick.w, h: pick.h };
}

export function registerScreenshotTool(
  mcp: McpServer,
  ctx: MutationContext,
  jit: TailwindJit,
): void {
  mcp.registerTool(
    "screenshot",
    {
      description:
        'Render a screen headless via Playwright and return the PNG as image content. mode: "light" (default), "dark", or "compare". w/h default to the desktop viewport preset; the screen renders responsively at that size. Defaults fullPage: true.',
      inputSchema: {
        screenId: z.string(),
        w: z.number().int().positive().optional(),
        h: z.number().int().positive().optional(),
        mode: z.enum(["light", "dark", "compare"]).optional(),
        fullPage: z.boolean().optional(),
      },
    },
    async ({ screenId, w, h, mode, fullPage }) => {
      const screen = ctx.folder.screens.get(screenId);
      if (!screen) return errorResult(`Screen not found: ${screenId}`);

      const defaults = defaultViewport(ctx.folder);
      const viewport: Viewport = { w: w ?? defaults.w, h: h ?? defaults.h };

      let buf: Buffer;
      try {
        const snapshotCss = await jit.build();
        if (mode === "compare") {
          const [light, dark] = await Promise.all([
            renderScreen(screen, ctx.folder.theme, {
              viewport,
              snapshotCss,
              snippets: ctx.folder.snippets,
              dark: false,
            }),
            renderScreen(screen, ctx.folder.theme, {
              viewport,
              snapshotCss,
              snippets: ctx.folder.snippets,
              dark: true,
            }),
          ]);
          buf = await screenshotCompareBuffer({
            leftHtml: light.html,
            rightHtml: dark.html,
            viewport,
          });
        } else {
          const { html } = await renderScreen(screen, ctx.folder.theme, {
            viewport,
            snapshotCss,
            snippets: ctx.folder.snippets,
            dark: mode === "dark",
          });
          buf = await screenshotBuffer({
            html,
            viewport,
            fullPage: fullPage ?? true,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/Cannot find package 'playwright'|MODULE_NOT_FOUND|chromium/.test(msg)) {
          return errorResult(playwrightMissingMessage(msg));
        }
        return errorResult(`screenshot failed: ${msg}`);
      }
      return {
        content: [{ type: "image", data: buf.toString("base64"), mimeType: "image/png" }],
      };
    },
  );

  mcp.registerTool(
    "render_snippet",
    {
      description:
        "Render a snippet in isolation and return a screenshot. Useful for iterating on a snippet's styling before stamping it. viewport defaults to 480×640.",
      inputSchema: {
        snippetId: z.string(),
        args: z.record(z.string(), z.unknown()).optional(),
        extraClassName: z.string().optional(),
        viewport: z
          .object({
            w: z.number().int().positive(),
            h: z.number().int().positive(),
          })
          .optional(),
        mode: z.enum(["light", "dark", "compare"]).optional(),
      },
    },
    async ({ snippetId, args, extraClassName, viewport, mode }) => {
      const snippet = ctx.folder.snippets.get(snippetId);
      if (!snippet) return errorResult(`Snippet not found: ${snippetId}`);

      const vp: Viewport = viewport ?? { w: 480, h: 640 };
      const screen: Screen = {
        id: `${snippet.id}__preview`,
        name: `${snippet.name} preview`,
        tree: {
          $snippet: snippet.id,
          ...(args && Object.keys(args).length > 0 ? { args } : {}),
          ...(extraClassName && extraClassName.trim() !== ""
            ? { $extraClassName: extraClassName.trim() }
            : {}),
        },
      };

      let buf: Buffer;
      try {
        const snapshotCss = await jit.build();
        if (mode === "compare") {
          const [light, dark] = await Promise.all([
            renderScreen(screen, ctx.folder.theme, {
              viewport: vp,
              snapshotCss,
              snippets: ctx.folder.snippets,
              dark: false,
            }),
            renderScreen(screen, ctx.folder.theme, {
              viewport: vp,
              snapshotCss,
              snippets: ctx.folder.snippets,
              dark: true,
            }),
          ]);
          buf = await screenshotCompareBuffer({
            leftHtml: light.html,
            rightHtml: dark.html,
            viewport: vp,
          });
        } else {
          const { html } = await renderScreen(screen, ctx.folder.theme, {
            viewport: vp,
            snapshotCss,
            snippets: ctx.folder.snippets,
            dark: mode === "dark",
          });
          buf = await screenshotBuffer({ html, viewport: vp, fullPage: true });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/Cannot find package 'playwright'|MODULE_NOT_FOUND|chromium/.test(msg)) {
          return errorResult(playwrightMissingMessage(msg));
        }
        return errorResult(`render_snippet failed: ${msg}`);
      }
      return {
        content: [{ type: "image", data: buf.toString("base64"), mimeType: "image/png" }],
      };
    },
  );
}
