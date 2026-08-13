import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { renderVariant, screenshotBuffer, screenshotCompareBuffer } from "@velloo/renderer";
import type { Variant } from "@velloo/schema";
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
  return `screenshot: Playwright is not installed in this environment. Run \`bunx playwright install chromium\` (or install the velloo binary which ships it). Underlying error: ${msg}`;
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
        'Render a variant headless via Playwright and return the PNG as image content. mode: "light" (default), "dark", or "compare" — compare returns one image with light + dark rendered side-by-side, the fastest way to confirm a page actually adapts. Defaults to fullPage: true so tall pages aren\'t clipped — pass fullPage: false to clip to the variant\'s viewport rectangle (ignored when mode: "compare"). Requires playwright + chromium (the velloo binary ships them).',
      inputSchema: {
        pageId: z.string(),
        variantId: z.string(),
        mode: z.enum(["light", "dark", "compare"]).optional(),
        fullPage: z.boolean().optional(),
      },
    },
    async ({ pageId, variantId, mode, fullPage }) => {
      const page = ctx.folder.pages.get(pageId);
      if (!page) return errorResult(`Page not found: ${pageId}`);
      const variant = page.variants.find((v) => v.id === variantId);
      if (!variant) return errorResult(`Variant not found: ${pageId}/${variantId}`);

      let buf: Buffer;
      try {
        const snapshotCss = await jit.build();
        if (mode === "compare") {
          const [light, dark] = await Promise.all([
            renderVariant(variant, ctx.folder.theme, {
              snapshotCss,
              snippets: ctx.folder.snippets,
              dark: false,
            }),
            renderVariant(variant, ctx.folder.theme, {
              snapshotCss,
              snippets: ctx.folder.snippets,
              dark: true,
            }),
          ]);
          buf = await screenshotCompareBuffer({
            leftHtml: light.html,
            rightHtml: dark.html,
            viewport: variant.viewport,
          });
        } else {
          const { html } = await renderVariant(variant, ctx.folder.theme, {
            snapshotCss,
            snippets: ctx.folder.snippets,
            dark: mode === "dark",
          });
          buf = await screenshotBuffer({
            html,
            viewport: variant.viewport,
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
        'Render a snippet in isolation and return a screenshot. Useful for iterating on a snippet\'s styling before stamping it into pages. Supplies the snippet as the variant root, applies the given `args` + optional `extraClassName`, and screenshots. mode: "light" | "dark" | "compare" mirrors `screenshot`. viewport defaults to 480×640.',
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

      // Synthesize a variant whose root is a $snippet instance. The renderer
      // resolves params + extraClassName the same way it would on a page.
      const vp = viewport ?? { w: 480, h: 640 };
      const variant: Variant = {
        id: `${snippet.id}__preview`,
        name: `${snippet.name} preview`,
        viewport: vp,
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
            renderVariant(variant, ctx.folder.theme, {
              snapshotCss,
              snippets: ctx.folder.snippets,
              dark: false,
            }),
            renderVariant(variant, ctx.folder.theme, {
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
          const { html } = await renderVariant(variant, ctx.folder.theme, {
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
