import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { MutationContext } from "../../mutations/index.ts";

type McpResult = {
  content: { type: "text"; text: string }[];
  isError?: true;
};

/** Basename-only, no traversal, no leading dots — same contract as generate_svg. */
function sanitizeFilename(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? "asset";
  return (
    base
      .replace(/\.\./g, "_")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/^[._-]+/, "")
      .replace(/_+/g, "_") || "asset"
  );
}

const MAX_BYTES = 5 * 1024 * 1024;

export function registerAssetTools(mcp: McpServer, ctx: MutationContext): void {
  mcp.registerTool(
    "upload_asset",
    {
      description:
        "Write base64 data into assets/ and get the /assets/<name> URL for <Image src>. Author SVG art directly and upload it — never fall back to stock placeholders for intentional imagery. Max 5MB.",
      inputSchema: {
        filename: z.string().describe('e.g. "hero-grain.svg", "cover.png"'),
        data: z.string().describe("base64-encoded file contents"),
        overwrite: z.boolean().optional().describe("Default true"),
      },
    },
    async ({ filename, data, overwrite }) => {
      const safe = sanitizeFilename(filename);
      let bytes: Buffer;
      try {
        bytes = Buffer.from(data, "base64");
      } catch {
        return {
          isError: true,
          content: [{ type: "text", text: "upload_asset: data is not valid base64" }],
        };
      }
      if (bytes.length === 0 || bytes.length > MAX_BYTES) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `upload_asset: decoded size ${bytes.length} bytes is outside (0, ${MAX_BYTES}]`,
            },
          ],
        };
      }
      const dir = join(ctx.folder.root, "assets");
      await mkdir(dir, { recursive: true });
      const abs = join(dir, safe);
      if (overwrite === false && (await Bun.file(abs).exists())) {
        return {
          isError: true,
          content: [{ type: "text", text: `upload_asset: ${safe} exists (overwrite: false)` }],
        };
      }
      await writeFile(abs, bytes);
      const result = {
        assetPath: `assets/${safe}`,
        url: `/assets/${safe}`,
        bytes: bytes.length,
      };
      return { content: [{ type: "text", text: JSON.stringify(result) }] } as McpResult;
    },
  );
}
