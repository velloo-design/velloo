import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { sanitizeSvgMarkup } from "@velloo/schema";

/**
 * Write JSON atomically: write to a sibling temp file, then rename. Crash-safe.
 */
export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  const body = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(tmp, body, "utf8");
  await rename(tmp, path);
}

export async function writeText(path: string, body: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body, "utf8");
}

/**
 * Extensions allowed in a design folder's `assets/` store. Restricted to images
 * and fonts so a `.html`/`.js`/`.svg`-that-navigates asset can never be written
 * and later served as active content from the canvas origin.
 */
export const ALLOWED_ASSET_EXTENSIONS: ReadonlySet<string> = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".svg",
  ".ico",
  ".bmp",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
]);

/** Content types for the allowed asset extensions (image/font only). */
export const ASSET_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".bmp": "image/bmp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

/** Lowercased extension (incl. dot), or "" if none. */
function extOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot).toLowerCase();
}

/** True when `filename`'s extension is an allowed image/font asset type. */
export function isAllowedAssetExt(filename: string): boolean {
  return ALLOWED_ASSET_EXTENSIONS.has(extOf(filename));
}

/** Basename-only, no traversal, no leading dots. */
export function sanitizeFilename(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? "asset";
  return (
    base
      .replace(/\.\./g, "_")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/^[._-]+/, "")
      .replace(/_+/g, "_") || "asset"
  );
}

/**
 * The one write path into a design folder's `assets/` store — `upload_asset`,
 * `import_assets`, and hosted generation all land files through here so naming
 * and layout stay identical.
 */
export async function storeAsset(
  root: string,
  filename: string,
  bytes: Buffer,
): Promise<{ assetPath: string; url: string; bytes: number }> {
  const safe = sanitizeFilename(filename);
  // Backstop: the tool handlers pre-check for a clean per-entry message, but no
  // path may land a non-image/font file in the web-served store.
  if (!isAllowedAssetExt(safe)) {
    throw new Error(`storeAsset: ${safe} is not an allowed image/font asset type`);
  }
  const dir = join(root, "assets");
  await mkdir(dir, { recursive: true });
  // SVGs are inlined via dangerouslySetInnerHTML and served from the canvas
  // origin — strip active content before it lands, whatever authored it
  // (upload_asset, import_assets, or hosted generation).
  const out = /\.svg$/i.test(safe)
    ? Buffer.from(sanitizeSvgMarkup(bytes.toString("utf8")), "utf8")
    : bytes;
  await writeFile(join(dir, safe), out);
  return { assetPath: `assets/${safe}`, url: `/assets/${safe}`, bytes: out.length };
}
