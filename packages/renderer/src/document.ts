import type { Viewport } from "@velloo/schema";
import { IFRAME_RUNTIME } from "./iframe-runtime.ts";

export interface DocumentOptions {
  viewport: Viewport;
  bodyHtml: string;
  /** Snapshot CSS (pre-compiled Tailwind output). */
  snapshotCss: string;
  /** Theme override CSS — ":root { --color-... }" rules. */
  themeCss: string;
  title?: string;
  /** When true, omit the iframe runtime script. Defaults to true. */
  includeRuntime?: boolean;
  /** Mount the dark-mode class on <html>. */
  dark?: boolean;
}

/**
 * Compose a self-contained HTML document. CSS is inlined; the iframe runtime
 * is included by default so the canvas can establish a message channel with
 * the rendered design.
 */
export function buildDocument(opts: DocumentOptions): string {
  const {
    viewport,
    bodyHtml,
    snapshotCss,
    themeCss,
    title = "Velloo design",
    includeRuntime = true,
    dark,
  } = opts;
  const runtime = includeRuntime ? `<script>${IFRAME_RUNTIME}</script>` : "";
  // Defeat password managers and form-fillers (LastPass / 1Password / Bitwarden
  // / native browser autofill) so design Input components stay clean.
  const antiAutofill =
    'data-1p-ignore="true" data-lpignore="true" data-bwignore="true" data-form-type="other" autocomplete="off"';
  const htmlClass = dark ? ' class="dark"' : "";
  return `<!doctype html>
<html lang="en"${htmlClass}>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=${viewport.w}, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>${snapshotCss}</style>
    <style>${themeCss}</style>
  </head>
  <body ${antiAutofill}>${bodyHtml}${runtime}</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
