import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { MutationContext } from "../../mutations/index.ts";

type McpResult = {
  content: { type: "text"; text: string }[];
  isError?: true;
};

/** Basename-only, no traversal, no leading dots. */
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
        "Write base64 data into assets/ and get the /assets/<name> URL for <Image src>. Author SVG art directly and upload it — never fall back to stock placeholders for intentional imagery. Max 5MB. For files already on disk (e.g. generated images), prefer `import_assets` — it reads them by path and avoids base64.",
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

  mcp.registerTool(
    "import_assets",
    {
      description:
        "Bulk-import existing image/SVG files into assets/ BY PATH — no base64. Reads each file from disk and copies it into the design folder's assets/, returning the /assets/<name> URL per file. Globs (containing *) are expanded relative to `baseDir` (default: the server's working dir). Ideal for pulling in many generated images at once — e.g. paths: ['../explore/*.png']. Max 5MB each; non-image extensions and oversized/missing files are reported per-entry, never throwing the whole batch.",
      inputSchema: {
        paths: z
          .array(z.string())
          .min(1)
          .describe(
            "Absolute or relative file paths and/or globs, e.g. ['../gen/*.png', '/abs/logo.svg']",
          ),
        baseDir: z
          .string()
          .optional()
          .describe("Base directory for resolving relative paths and globs. Default: process cwd."),
        overwrite: z.boolean().optional().describe("Default true"),
      },
    },
    async ({ paths, baseDir, overwrite }) => {
      const base = baseDir ?? process.cwd();
      const dir = join(ctx.folder.root, "assets");
      await mkdir(dir, { recursive: true });

      // expand globs + resolve relatives
      const sources: string[] = [];
      for (const p of paths) {
        if (p.includes("*") || p.includes("?") || p.includes("[")) {
          try {
            for await (const f of new Bun.Glob(p).scan({ cwd: base, absolute: true }))
              sources.push(f);
          } catch {
            /* malformed glob — skip, reported as zero matches */
          }
        } else {
          sources.push(isAbsolute(p) ? p : join(base, p));
        }
      }

      const results: Record<string, unknown>[] = [];
      for (const src of sources) {
        try {
          const file = Bun.file(src);
          if (!(await file.exists())) {
            results.push({ path: src, error: "not found" });
            continue;
          }
          const size = file.size;
          if (size === 0 || size > MAX_BYTES) {
            results.push({ path: src, error: `size ${size} bytes outside (0, ${MAX_BYTES}]` });
            continue;
          }
          const safe = sanitizeFilename(src);
          const abs = join(dir, safe);
          if (overwrite === false && (await Bun.file(abs).exists())) {
            results.push({ path: src, error: "exists (overwrite: false)" });
            continue;
          }
          await writeFile(abs, Buffer.from(await file.arrayBuffer()));
          results.push({
            path: src,
            assetPath: `assets/${safe}`,
            url: `/assets/${safe}`,
            bytes: size,
          });
        } catch (e) {
          results.push({ path: src, error: String((e as Error).message ?? e) });
        }
      }

      const imported = results.filter((r) => "url" in r).length;
      return {
        content: [
          { type: "text", text: JSON.stringify({ imported, matched: sources.length, results }) },
        ],
      } as McpResult;
    },
  );
}
