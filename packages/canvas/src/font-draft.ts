import { isCssIdent, sanitizeCssTokenValue } from "@velloo/schema";
import { googleFontUrl } from "@velloo/schema/fonts";

/**
 * A face being tried on in the font browser, before it is committed.
 *
 * Browsing is the whole point of a picker, and a family is unjudgeable at
 * list-row size — you have to see it set as the design's own heading. So
 * highlighting a family paints it across every frame the way a dragged rhythm
 * control does, and only a click writes it to the theme.
 */
export interface FontDraft {
  /** The font role being previewed — `display`, `sans`, whatever it is called. */
  role: string;
  family: string;
  /** Full CSS stack, family first. */
  stack: string;
  /** css2 axis spec, or `true`. Absent for a face that needs no webfont. */
  google?: string | true;
}

/** The `--font-<role>` override that repoints the role for one document. */
export function fontDraftCss(draft: FontDraft): string {
  if (!isCssIdent(draft.role)) return "";
  return `:root {\n  --font-${draft.role}: ${sanitizeCssTokenValue(draft.stack)};\n}`;
}

/**
 * The stylesheet that loads the previewed family, or null when there is
 * nothing to fetch. Separate from the CSS because it is a `<link>`: the font
 * has to be requested before the override that names it means anything.
 */
export function fontDraftUrl(draft: FontDraft): string | null {
  return draft.google ? googleFontUrl(draft.google, draft.family) : null;
}
