import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { renderVariant, screenshotBuffer } from "@velloo/renderer";
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

export function registerScreenshotTool(
  mcp: McpServer,
  ctx: MutationContext,
  jit: TailwindJit,
): void {
  mcp.registerTool(
    "screenshot",
    {
      description:
        'Render a variant headless via Playwright and return the PNG as image content. Pass mode: "dark" to apply the dark color block. Requires playwright + chromium (the velloo binary ships them); if Playwright is missing this returns an error explaining how to install it.',
      inputSchema: {
        pageId: z.string(),
        variantId: z.string(),
        mode: z.enum(["light", "dark"]).optional(),
      },
    },
    async ({ pageId, variantId, mode }) => {
      const page = ctx.folder.pages.get(pageId);
      if (!page) return errorResult(`Page not found: ${pageId}`);
      const variant = page.variants.find((v) => v.id === variantId);
      if (!variant) return errorResult(`Variant not found: ${pageId}/${variantId}`);

      let buf: Buffer;
      try {
        const snapshotCss = await jit.build();
        const { html } = await renderVariant(variant, ctx.folder.theme, {
          snapshotCss,
          snippets: ctx.folder.snippets,
          dark: mode === "dark",
        });
        buf = await screenshotBuffer({ html, viewport: variant.viewport });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/Cannot find package 'playwright'|MODULE_NOT_FOUND|chromium/.test(msg)) {
          return errorResult(
            `screenshot: Playwright is not installed in this environment. Run \`bunx playwright install chromium\` (or install the velloo binary which ships it). Underlying error: ${msg}`,
          );
        }
        return errorResult(`screenshot failed: ${msg}`);
      }
      return {
        content: [{ type: "image", data: buf.toString("base64"), mimeType: "image/png" }],
      };
    },
  );
}
