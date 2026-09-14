import { neutralizeCssText, sanitizeGoogleFontSpec, type Viewport } from "@velloo/schema";
import { CANVAS_RUNTIME } from "./canvas-runtime.ts";
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
  adapterCss?: string | undefined;
  /**
   * Folder-scoped escape-hatch CSS (theme/custom.css) — keyframes,
   * textures, clip-paths. Injected last so it can override anything.
   */
  customCss?: string | undefined;
  /** Google Fonts css2 family specs to load via <link>. */
  googleFonts?: string[] | undefined;
  /**
   * Origin for resolving root-relative URLs (/assets/…) when the doc is
   * rendered outside the server origin (Playwright setContent pages).
   */
  baseHref?: string | undefined;
  title?: string | undefined;
  /** When true, omit the iframe runtime script. Defaults to true. */
  includeRuntime?: boolean | undefined;
  /**
   * Let the runtime draw its own selection box. Off by default: on a board the
   * parent draws it, square-cornered, so it agrees with the resize grips. A
   * preview that has neither grips nor a parent overlay — the snippet editor —
   * needs the iframe to draw one or a click selects invisibly.
   */
  selectionRing?: boolean | undefined;
  /** Mount the dark-mode class on <html>. */
  dark?: boolean | undefined;
  /**
   * Root-relative URL of the live-island bundle (e.g.
   * "/api/live/bundle.js?v=3"). Set only when the screen has live nodes;
   * injects the client mount runtime that fills the SSR markers.
   */
  liveBundleUrl?: string | undefined;
  /**
   * Framework-native canvas bundle (#18): the installed-component `mountScreen`
   * URL + the resolved screen tree + native theme options. When set, the SSR
   * body is wrapped in `#velloo-ssr` and the canvas runtime client-mounts the
   * exact installed version over it (restoring the SSR on any failure).
   */
  canvasBundle?: { url: string; tree: unknown; themeOptions: unknown } | undefined;
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
    canvasBundle,
    selectionRing,
  } = opts;
  const runtime = includeRuntime ? `<script>${IFRAME_RUNTIME}</script>` : "";
  const live = liveBundleUrl
    ? `<script>${LIVE_RUNTIME.replace("__VELLOO_LIVE_BUNDLE_URL__", JSON.stringify(liveBundleUrl))}</script>`
    : "";
  // The installed-component client mount (#18): the SSR body becomes the
  // fallback inside #velloo-ssr; the runtime mounts the bundle over it.
  const canvas = canvasBundle
    ? `<script type="application/json" id="velloo-canvas-data">${jsonForScript({ tree: canvasBundle.tree, themeOptions: canvasBundle.themeOptions })}</script>` +
      `<script>${CANVAS_RUNTIME.replace("__VELLOO_CANVAS_BUNDLE_URL__", JSON.stringify(canvasBundle.url))}</script>`
    : "";
  const body = canvasBundle ? `<div id="velloo-ssr">${bodyHtml}</div>` : bodyHtml;
  const fontLinks =
    googleFonts && googleFonts.length > 0
      ? // Entries are already in css2 `family=` value syntax (spaces as `+`,
        // axis after `:`, e.g. "Cal+Sans" or "Inter:wght@400..700"). Emit them
        // verbatim — `encodeURIComponent` would turn `+`/`@`/`,` into `%2B`/
        // `%40`/`%2C`, which css2 reads as literal characters, so Google can't
        // find the family and the font silently never loads. Only a stray
        // literal space needs folding to `+` (mirrors emit-theme/globals-css).
        `\n    <link rel="preconnect" href="https://fonts.googleapis.com" />\n    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />\n    <link rel="stylesheet" href="${escapeHtml(
          `https://fonts.googleapis.com/css2?${googleFonts
            .map((f) => `family=${sanitizeGoogleFontSpec(f)}`)
            .join("&")}&display=swap`,
        )}" />`
      : "";
  const adapterStyle =
    adapterCss && adapterCss.trim() !== ""
      ? `\n    <style data-velloo-adapter>${neutralizeCssText(adapterCss)}</style>`
      : "";
  const customStyle =
    customCss && customCss.trim() !== ""
      ? `\n    <style>${neutralizeCssText(customCss)}</style>`
      : "";
  // Widens the width the runtime's `.__velloo-selected` rule reads; the rule
  // itself lives with the rest of the chrome CSS in iframe-runtime.ts. It has
  // to be an inline property, not a `:root` rule — the runtime appends its own
  // stylesheet at parse time, so a rule in this head would lose the tie to the
  // 0px default. `setChromeScale` drives its two siblings the same way.
  const selectionRingStyle = selectionRing ? ' style="--velloo-ring-select: 2px"' : "";
  // Defeat password managers and form-fillers (LastPass / 1Password / Bitwarden
  // / native browser autofill) so design Input components stay clean.
  const antiAutofill =
    'data-1p-ignore="true" data-lpignore="true" data-bwignore="true" data-form-type="other" autocomplete="off"';
  const htmlClass = dark ? ' class="dark"' : "";
  return `<!doctype html>
<html lang="en"${htmlClass}${selectionRingStyle}>
  <head>
    <meta charset="utf-8" />${baseHref ? `\n    <base href="${escapeHtml(baseHref)}" />` : ""}
    <meta name="viewport" content="width=${viewport.w}, initial-scale=1" />
    <title>${escapeHtml(title)}</title>${fontLinks}
    <style>${snapshotCss}</style>
    <style>${neutralizeCssText(themeCss)}</style>${adapterStyle}${customStyle}
  </head>
  <body ${antiAutofill}>${body}${runtime}${live}${canvas}</body>
</html>`;
}

/** JSON safe to inline in a `<script>` — escape `<` so `</script>` can't break out. */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
