import type { Viewport } from "@velloo/schema";
import { IFRAME_RUNTIME } from "./iframe-runtime.ts";
import { LIVE_RUNTIME } from "./live-runtime.ts";

export interface DocumentOptions {
  viewport: Viewport;
  bodyHtml: string;
  /** Snapshot CSS (pre-compiled Tailwind output). */
  snapshotCss: string;
  /** Theme override CSS — ":root { --color-... }" rules. */
  themeCss: string;
  /**
   * CSS contributed by the active framework adapter's render pass — e.g. the
   * critical emotion CSS extracted while SSR-ing MUI. Layered above theme,
   * below the user's custom.css. Empty for Tailwind-class frameworks.
   */
  adapterCss?: string;
  /**
   * Folder-scoped escape-hatch CSS (theme/custom.css) — keyframes,
   * textures, clip-paths. Injected last so it can override anything.
   */
  customCss?: string;
  /** Google Fonts css2 family specs to load via <link>. */
  googleFonts?: string[];
  /**
   * Origin for resolving root-relative URLs (/assets/…) when the doc is
   * rendered outside the server origin (Playwright setContent pages).
   */
  baseHref?: string;
  title?: string;
  /** When true, omit the iframe runtime script. Defaults to true. */
  includeRuntime?: boolean;
  /** Mount the dark-mode class on <html>. */
  dark?: boolean;
  /**
   * Root-relative URL of the live-island bundle (e.g.
   * "/api/live/bundle.js?v=3"). Set only when the screen has live nodes;
   * injects the client mount runtime that fills the SSR markers.
   */
  liveBundleUrl?: string;
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
    adapterCss,
    customCss,
    googleFonts,
    baseHref,
    title = "Velloo design",
    includeRuntime = true,
    dark,
    liveBundleUrl,
  } = opts;
  const runtime = includeRuntime ? `<script>${IFRAME_RUNTIME}</script>` : "";
  const live = liveBundleUrl
    ? `<script>${LIVE_RUNTIME.replace("__VELLOO_LIVE_BUNDLE_URL__", JSON.stringify(liveBundleUrl))}</script>`
    : "";
  const fontLinks =
    googleFonts && googleFonts.length > 0
      ? // Entries are already in css2 `family=` value syntax (spaces as `+`,
        // axis after `:`, e.g. "Cal+Sans" or "Inter:wght@400..700"). Emit them
        // verbatim — `encodeURIComponent` would turn `+`/`@`/`,` into `%2B`/
        // `%40`/`%2C`, which css2 reads as literal characters, so Google can't
        // find the family and the font silently never loads. Only a stray
        // literal space needs folding to `+` (mirrors emit-theme/globals-css).
        `\n    <link rel="preconnect" href="https://fonts.googleapis.com" />\n    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />\n    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?${googleFonts
          .map((f) => `family=${f.replace(/ /g, "+")}`)
          .join("&")}&display=swap" />`
      : "";
  const adapterStyle =
    adapterCss && adapterCss.trim() !== "" ? `\n    <style data-velloo-adapter>${adapterCss}</style>` : "";
  const customStyle =
    customCss && customCss.trim() !== "" ? `\n    <style>${customCss}</style>` : "";
  // Defeat password managers and form-fillers (LastPass / 1Password / Bitwarden
  // / native browser autofill) so design Input components stay clean.
  const antiAutofill =
    'data-1p-ignore="true" data-lpignore="true" data-bwignore="true" data-form-type="other" autocomplete="off"';
  const htmlClass = dark ? ' class="dark"' : "";
  return `<!doctype html>
<html lang="en"${htmlClass}>
  <head>
    <meta charset="utf-8" />${baseHref ? `\n    <base href="${escapeHtml(baseHref)}" />` : ""}
    <meta name="viewport" content="width=${viewport.w}, initial-scale=1" />
    <title>${escapeHtml(title)}</title>${fontLinks}
    <style>${snapshotCss}</style>
    <style>${themeCss}</style>${adapterStyle}${customStyle}
  </head>
  <body ${antiAutofill}>${bodyHtml}${runtime}${live}</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
