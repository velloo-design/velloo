/**
 * CSS-injection hardening for untrusted design-folder strings that reach an
 * inline `<style>` (the renderer's canvas + Playwright document) or an emitted
 * stylesheet (codegen's globals.css). Theme values, palette entries, custom.css,
 * and Google-font specs are authored by whoever wrote the design JSON, so a
 * value like `#fff</style><script>…</script>` must not break out of the style
 * element or the declaration. This is the single home for that logic — the
 * renderer's `theme-to-css.ts`/`document.ts` and codegen's `emit-theme` both
 * route through it (mirrors how `svg-sanitize.ts` centralizes SVG safety).
 */

/** A CSS custom-property / token name: letters, digits, dash, underscore only. */
const CSS_IDENT_RE = /^[A-Za-z0-9_-]+$/;

/** True when `name` is safe to interpolate as a `--<name>` token identifier. */
export function isCssIdent(name: string): boolean {
  return CSS_IDENT_RE.test(name);
}

/**
 * Make an untrusted theme *token value* safe to interpolate into a CSS
 * declaration. Theme values (colors, spacing, shadows, radius, font stacks,
 * animation shorthands) never legitimately contain declaration/element/comment
 * delimiters, so strip the characters that could break out — `<> {} ;`,
 * backslash, the comment-close `*​/`, and newlines — while preserving everything
 * a real value needs (parens, commas, quotes, %, #, dots, spaces).
 */
export function sanitizeCssTokenValue(value: string): string {
  return value
    .replace(/\*\//g, "")
    .replace(/[<>{};\\]/g, "")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

/**
 * Neutralize an untrusted *raw CSS block* (folder custom.css, adapter emotion
 * CSS) for inlining into an HTML `<style>` element. The only breakout from a
 * raw-text element is the end-tag sequence `</`, so escape it: `<\/` is inert to
 * the HTML tokenizer and reads as `/` to the CSS parser (a valid escape,
 * preserved even inside `url()`/string values). Structural CSS (`;{}`) is left
 * intact because the block IS structural CSS.
 */
export function neutralizeCssText(css: string): string {
  return css.replace(/<\//g, "<\\/");
}

/**
 * Restrict a Google Fonts css2 `family=` spec to the characters the syntax
 * actually uses (family name + `ital,wght@…;…` axis tuples), folding spaces to
 * `+`. Drops anything that could break out of the `<link href>` attribute or the
 * `@import url("…")` string (quotes, angle brackets, parens, backslash).
 */
export function sanitizeGoogleFontSpec(spec: string): string {
  return spec.replace(/[^A-Za-z0-9 +:,.;@_-]/g, "").replace(/ /g, "+");
}
