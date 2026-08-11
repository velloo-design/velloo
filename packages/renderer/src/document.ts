import type { Viewport } from "@velloo/schema";

export interface DocumentOptions {
  viewport: Viewport;
  bodyHtml: string;
  /** Snapshot CSS (pre-compiled Tailwind output). */
  snapshotCss: string;
  /** Theme override CSS — ":root { --color-... }" rules. */
  themeCss: string;
  title?: string;
}

/**
 * Compose a self-contained HTML document for headless rendering or a
 * canvas iframe payload. CSS is inlined in <style> tags so the document
 * has no external dependencies.
 */
export function buildDocument(opts: DocumentOptions): string {
  const { viewport, bodyHtml, snapshotCss, themeCss, title = "Velloo design" } = opts;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=${viewport.w}, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>${snapshotCss}</style>
    <style>${themeCss}</style>
  </head>
  <body>${bodyHtml}</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
