import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { renderScreen, screenshotBuffer, screenshotCompareBuffer } from "@velloo/renderer";
import type { Screen, Viewport } from "@velloo/schema";
import { z } from "zod";
import { themeByName } from "../../design-folder.ts";
import type { LiveBundler } from "../../live/component-bundler.ts";
import type { MutationContext } from "../../mutations/index.ts";
import { registryForScreen } from "../../mutations/lookup.ts";
import type { TailwindJit } from "../../styles/tailwind-jit.ts";
import { RenderModeSchema, ThemeNameSchema, ViewportSchema } from "./schemas.ts";
import {
  browserErrorMessage,
  captureTimeoutMessage,
  errorResult,
  makeLiveUrl,
} from "./screenshot-helpers.ts";

export function registerRenderSnippetTool(
  mcp: McpServer,
  ctx: MutationContext,
  jit: TailwindJit,
  bundler: LiveBundler,
  assetOrigin?: string,
): void {
  const liveUrl = makeLiveUrl(ctx, bundler);

  mcp.registerTool(
    "render_snippet",
    {
      description:
        "Render a snippet in isolation and return a screenshot. Useful for iterating on a snippet's styling before stamping it. viewport defaults to 480×640.",
      inputSchema: {
        snippetId: z.string(),
        args: z.record(z.string(), z.unknown()).optional(),
        extraClassName: z.string().optional(),
        viewport: ViewportSchema.optional().describe("Defaults to 480×640"),
        mode: RenderModeSchema,
        scale: z.number().min(0.25).max(1).optional(),
        theme: ThemeNameSchema,
      },
    },
    async ({ snippetId, args, extraClassName, viewport, mode, scale, theme }) => {
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
        // A preview's args / extraClassName live only in this in-memory screen,
        // so the disk scan can't see them — feed their class tokens as extra
        // JIT candidates, or an arbitrary value passed through a string param
        // (`from-[hsl(…)]`) silently wouldn't paint in the preview.
        const extraCandidates: string[] = [];
        if (extraClassName) extraCandidates.push(...extraClassName.split(/\s+/));
        for (const v of Object.values(args ?? {})) {
          if (typeof v === "string") extraCandidates.push(...v.split(/\s+/));
        }
        const snapshotCss = await jit.build(extraCandidates.filter(Boolean));
        // render_snippet: a synthesized screen wraps the snippet instance
        // so registry resolution honors the snippet's library, not a stray
        // default. Wrap the synthetic screen with the snippet's library so
        // ext placeholders still merge in.
        const syntheticScreen = { ...screen, library: snippet.library };
        const screenRegistry = registryForScreen(ctx, syntheticScreen);
        if (mode === "compare") {
          const [light, dark] = await Promise.all([
            renderScreen(syntheticScreen, themeByName(ctx.folder, theme), {
              viewport: vp,
              snapshotCss,
              registry: screenRegistry,
              snippets: ctx.folder.snippets,
              customCss: ctx.folder.customCss,
              baseHref: assetOrigin,
              liveBundleUrl: liveUrl(),
              dark: false,
            }),
            renderScreen(syntheticScreen, themeByName(ctx.folder, theme), {
              viewport: vp,
              snapshotCss,
              registry: screenRegistry,
              snippets: ctx.folder.snippets,
              customCss: ctx.folder.customCss,
              baseHref: assetOrigin,
              liveBundleUrl: liveUrl(),
              dark: true,
            }),
          ]);
          buf = await screenshotCompareBuffer({
            leftHtml: light.html,
            rightHtml: dark.html,
            viewport: vp,
            ...(scale ? { deviceScaleFactor: scale } : {}),
          });
        } else {
          const { html } = await renderScreen(syntheticScreen, themeByName(ctx.folder, theme), {
            viewport: vp,
            snapshotCss,
            registry: screenRegistry,
            snippets: ctx.folder.snippets,
            customCss: ctx.folder.customCss,
            baseHref: assetOrigin,
            liveBundleUrl: liveUrl(),
            dark: mode === "dark",
          });
          buf = await screenshotBuffer({
            html,
            viewport: vp,
            fullPage: true,
            ...(scale ? { deviceScaleFactor: scale } : {}),
          });
        }
      } catch (err) {
        const bm = browserErrorMessage(err);
        if (bm) return errorResult(bm);
        const tm = captureTimeoutMessage(err, "render_snippet");
        if (tm) return errorResult(tm);
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(`render_snippet failed: ${msg}`);
      }
      return {
        content: [{ type: "image", data: buf.toString("base64"), mimeType: "image/png" }],
      };
    },
  );
}
