/**
 * Active-content sanitization for SVG markup. SVG that ends up inlined via
 * `dangerouslySetInnerHTML` (the `<SVG content>` helper), emitted into a
 * consumer app by codegen, or written to a design folder's `assets/` store is
 * untrusted (a design-JSON author or a hosted generator authored it) and can
 * carry executing-capable content: `<script>`, `<foreignObject>`, inline `on*=`
 * handlers, `javascript:`/`data:text/html` URLs, and SMIL animation elements
 * (`<set>`/`<animate>` can script). This module is the single source of that
 * logic — the render boundary, codegen emit, and the asset store all route
 * through it so no path inlines unsanitized SVG.
 *
 * `svg.tsx` (copied verbatim into user apps by `installSnapshot`) keeps an
 * inline twin of `sanitizeSvgMarkup` because it cannot import `@velloo/*`.
 */

const ACTIVE_SVG_PATTERNS: readonly RegExp[] = [
  /<\s*script[\s>]/i,
  /<\s*foreignObject[\s>]/i,
  // onload= / onclick= / onerror= / … — the lead char class catches a handler
  // that abuts a preceding attribute's closing quote or a `/` (`class="x"onclick=`,
  // `<a/onmouseover=`), not just whitespace-separated ones.
  /[\s/"']on[a-z]+\s*=/i,
  /(?:xlink:href|href|src)\s*=\s*["']?\s*(?:javascript:|data:text\/html)/i,
  /<\s*(?:animate|animateTransform|animateMotion|animateColor|set)[\s>]/i, // SMIL
];

/** True when `markup` contains executing-capable SVG (script/handlers/URLs/SMIL). */
export function svgLooksActive(markup: string): boolean {
  return ACTIVE_SVG_PATTERNS.some((re) => re.test(markup));
}

/**
 * Strip active content from SVG markup, leaving the static drawing intact.
 * Removes script/foreignObject/SMIL elements, inline event handlers, and
 * neutralizes `javascript:`/`data:text/html` URLs. Prefer this over
 * `svgLooksActive` where a clean render is wanted rather than an outright
 * rejection; the two agree on what counts as "active".
 */
export function sanitizeSvgMarkup(markup: string): string {
  return (
    markup
      // Drop <script>/<foreignObject> elements wholesale, including their contents.
      .replace(/<\s*(script|foreignObject)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
      // Drop any leftover script/foreignObject/SMIL tags (unpaired or self-closing).
      .replace(
        /<\s*\/?\s*(?:script|foreignObject|animate|animateTransform|animateMotion|animateColor|set)\b[^>]*>/gi,
        "",
      )
      // Strip inline event handlers (on*="…" / on*='…' / on*=bare), including
      // ones that abut a preceding attribute's quote or a `/`. Keep the lead
      // separator so the previous attribute stays terminated.
      .replace(/([\s/"'])on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "$1")
      // Neutralize javascript:/data:text/html in href/src/xlink:href.
      .replace(
        /((?:xlink:href|href|src)\s*=\s*)(?:"\s*(?:javascript:|data:text\/html)[^"]*"|'\s*(?:javascript:|data:text\/html)[^']*'|(?:javascript:|data:text\/html)[^\s>]*)/gi,
        '$1"#"',
      )
  );
}
