import { readdir, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { assetReferences, readAssetsFile } from "../../assets-store.ts";
import {
  ALLOWED_ASSET_EXTENSIONS,
  isAllowedAssetExt,
  sanitizeFilename,
  storeAsset,
} from "../../fs.ts";
import type { MutationContext } from "../../mutations/index.ts";
import { errorResult, jsonResult } from "./result.ts";

const MAX_BYTES = 5 * 1024 * 1024;

export function registerAssetTools(mcp: McpServer, ctx: MutationContext): void {
  mcp.registerTool(
    "list_assets",
    {
      description:
        "List the folder's assets/ files — the `/assets/<name>` URL for <Image src>, size, whether any screen or snippet still references it, and the originating prompt for anything `generate_asset` produced. Check here before spending on art you may already have.",
      inputSchema: {
        unusedOnly: z.boolean().optional().describe("Only assets nothing references"),
      },
    },
    async ({ unusedOnly }) => {
      const dir = join(ctx.folder.root, "assets");
      const names = await readdir(dir).catch(() => [] as string[]);
      const provenance = await readAssetsFile(ctx.folder.root);
      // Provenance is keyed by the stored path ("assets/<name>").
      const assets = [];
      for (const name of names.sort()) {
        if (name.startsWith(".")) continue;
        const info = await stat(join(dir, name)).catch(() => null);
        if (!info?.isFile()) continue;
        const usedBy = assetReferences(ctx.folder, `assets/${name}`);
        if (unusedOnly && usedBy.length > 0) continue;
        const gen = provenance.generated[`assets/${name}`];
        assets.push({
          url: `/assets/${name}`,
          bytes: info.size,
          usedBy,
          ...(gen
            ? {
                generated: {
                  prompt: gen.prompt,
                  intent: gen.intent,
                  generatedAt: gen.generatedAt,
                },
              }
            : {}),
        });
      }
      return jsonResult({ assets });
    },
  );

  mcp.registerTool(
    "upload_asset",
    {
      description:
        "Write base64 data into assets/ and get the `/assets/<name>` URL for <Image src>. Author SVG art directly and upload it — never fall back to stock placeholders for intentional imagery. Max 5MB. For files already on disk, prefer `import_assets`.",
      inputSchema: {
        filename: z.string().describe('e.g. "hero-grain.svg", "cover.png"'),
        data: z.string().describe("base64-encoded file contents"),
        overwrite: z.boolean().optional().describe("Default true"),
      },
    },
    async ({ filename, data, overwrite }) => {
      const safe = sanitizeFilename(filename);
      if (!isAllowedAssetExt(safe)) {
        return errorResult(
          `upload_asset: ${safe} is not an allowed asset type (${[...ALLOWED_ASSET_EXTENSIONS].join(", ")})`,
        );
      }
      let bytes: Buffer;
      try {
        bytes = Buffer.from(data, "base64");
      } catch {
        return errorResult("upload_asset: data is not valid base64");
      }
      if (bytes.length === 0 || bytes.length > MAX_BYTES) {
        return errorResult(
          `upload_asset: decoded size ${bytes.length} bytes is outside (0, ${MAX_BYTES}]`,
        );
      }
      const abs = join(ctx.folder.root, "assets", safe);
      if (overwrite === false && (await Bun.file(abs).exists())) {
        return errorResult(`upload_asset: ${safe} exists (overwrite: false)`);
      }
      const result = await storeAsset(ctx.folder.root, safe, bytes);
      return jsonResult(result);
    },
  );

  mcp.registerTool(
    "import_assets",
    {
      description:
        "Bulk-import image/SVG files into assets/ BY PATH — no base64 — returning the `/assets/<name>` URL per file. Globs are expanded relative to `baseDir` (default: the server's working dir), so `paths: ['../explore/*.png']` pulls in a whole batch. Max 5MB each; bad or missing files are reported per entry rather than failing the call.",
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
          if (!isAllowedAssetExt(src)) {
            results.push({ path: src, error: "not an allowed image/font asset type" });
            continue;
          }
          const size = file.size;
          if (size === 0 || size > MAX_BYTES) {
            results.push({ path: src, error: `size ${size} bytes outside (0, ${MAX_BYTES}]` });
            continue;
          }
          const safe = sanitizeFilename(src);
          if (overwrite === false && (await Bun.file(join(dir, safe)).exists())) {
            results.push({ path: src, error: "exists (overwrite: false)" });
            continue;
          }
          const stored = await storeAsset(
            ctx.folder.root,
            safe,
            Buffer.from(await file.arrayBuffer()),
          );
          results.push({ path: src, ...stored });
        } catch (e) {
          results.push({ path: src, error: String((e as Error).message ?? e) });
        }
      }

      const imported = results.filter((r) => "url" in r).length;
      return jsonResult({ imported, matched: sources.length, results });
    },
  );
}
