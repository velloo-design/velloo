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
