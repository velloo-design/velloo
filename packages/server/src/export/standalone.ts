import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

/**
 * Standalone-HTML inlining: make a rendered screen document fully
 * self-contained so it opens from file:// with no velloo server — referenced
 * /assets/… files become data URIs and the Google Fonts stylesheet (plus its
 * font files) is embedded. Single-file output only; a zip-with-relative-assets
 * variant is explicitly out of scope for this cut.
 */

export interface StandaloneResult {
  html: string;
  /** Human-readable caveats: missing assets, un-embeddable fonts, size. */
  warnings: string[];
}

/** Above this, the export warns that the single file is getting heavy. */
export const STANDALONE_WARN_BYTES = 8 * 1024 * 1024;

const ASSET_REF = /\/assets\/[A-Za-z0-9._@\-/]+/g;

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

/** Chrome UA so css2 answers with woff2 sources instead of legacy ttf. */
const FONT_FETCH_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export interface InlineOptions {
  /** Design-folder root — /assets/… refs resolve inside it. */
  assetRoot: string;
  /** Board composites size-check once on the final document, not per frame. */
  skipSizeWarning?: boolean | undefined;
}

/**
 * An exported file opens from disk with no velloo runtime and carries no
 * scripts of its own, so nothing in it should run: design-authored SVG that got
 * past sanitization, a stray handler, a `javascript:` link. Board composites
 * embed frames as srcdoc iframes, which inherit this policy from their parent.
 */
const STANDALONE_CSP = "script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

/** Insert the no-script policy as the first element of `<head>`. */
export function withStandalonePolicy(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${STANDALONE_CSP}">`;
  const head = /<head\b[^>]*>/i.exec(html);
  if (!head) return `${meta}${html}`;
  const at = head.index + head[0].length;
  return `${html.slice(0, at)}${meta}${html.slice(at)}`;
}

export async function inlineStandaloneDocument(
  html: string,
  opts: InlineOptions,
): Promise<StandaloneResult> {
  const warnings: string[] = [];
  let out = await inlineAssets(withStandalonePolicy(html), opts.assetRoot, warnings);
  out = await inlineGoogleFonts(out, warnings);
  if (!opts.skipSizeWarning) warnings.push(...sizeWarning(out));
  return { html: out, warnings };
}

/** The size caveat for a finished document (exported for board composites). */
export function sizeWarning(html: string): string[] {
  const bytes = Buffer.byteLength(html, "utf8");
  return bytes > STANDALONE_WARN_BYTES
    ? [
        `the exported file is ${(bytes / (1024 * 1024)).toFixed(1)}MB — embedded assets add up; consider trimming large images`,
      ]
    : [];
}

async function inlineAssets(html: string, assetRoot: string, warnings: string[]): Promise<string> {
  const refs = [...new Set(html.match(ASSET_REF) ?? [])];
  let out = html;
  for (const ref of refs) {
    // Shape-constrained by the regex, but keep the containment check explicit.
    const rel = normalize(ref.replace(/^\//, ""));
    if (rel.startsWith("..")) continue;
    try {
      const bytes = await readFile(join(assetRoot, rel));
      const mime = MIME[extname(rel).toLowerCase()] ?? "application/octet-stream";
      out = out.replaceAll(ref, `data:${mime};base64,${bytes.toString("base64")}`);
    } catch {
      warnings.push(`asset not found, left as a dead reference: ${ref}`);
    }
  }
  return out;
}

/**
 * Embed the Google Fonts stylesheet the document links (buildDocument emits
 * exactly one css2 <link>): fetch the CSS with a modern-Chrome UA (woff2
 * sources), data-URI every font file into it, and replace the link (and its
 * preconnects) with an inline <style>. Any network failure keeps the original
 * links — the file still renders online — and records a warning.
 */
async function inlineGoogleFonts(html: string, warnings: string[]): Promise<string> {
  const linkMatch =
    /<link rel="stylesheet" href="(https:\/\/fonts\.googleapis\.com\/css2[^"]*)"\s*\/>/.exec(html);
  if (!linkMatch?.[1]) return html;
  const cssUrl = linkMatch[1].replaceAll("&amp;", "&");
  try {
    const cssRes = await fetch(cssUrl, { headers: { "user-agent": FONT_FETCH_UA } });
    if (!cssRes.ok) throw new Error(`fonts css fetch failed (${cssRes.status})`);
    let css = await cssRes.text();
    const fontUrls = [
      ...new Set(
        [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com[^)]+)\)/g)].map(
          (m) => m[1] as string,
        ),
      ),
    ];
    for (const url of fontUrls) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`font file fetch failed (${res.status})`);
      const bytes = Buffer.from(await res.arrayBuffer());
      const mime = url.endsWith(".woff2")
        ? "font/woff2"
        : (MIME[extname(new URL(url).pathname)] ?? "font/woff2");
      css = css.replaceAll(url, `data:${mime};base64,${bytes.toString("base64")}`);
    }
    return html
      .replace(
        /\n[ \t]*<link rel="preconnect" href="https:\/\/fonts\.[^"]*"(?: crossorigin)? ?\/>/g,
        "",
      )
      .replace(linkMatch[0], `<style data-velloo-fonts>${css}</style>`);
  } catch (err) {
    warnings.push(
      `webfonts were not embedded (${err instanceof Error ? err.message : String(err)}) — the file loads them from Google Fonts when opened online`,
    );
    return html;
  }
}
