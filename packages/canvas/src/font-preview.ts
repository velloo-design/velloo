import { googleFontUrl } from "@velloo/schema/fonts";

/**
 * Families already requested into the canvas's own document head. Module-scoped
 * so remounting a panel doesn't refetch what is already there.
 */
const requested = new Set<string>();

/**
 * Load a family into the canvas document so a control can render its own name
 * in its own face.
 *
 * `text` narrows the request to the glyphs actually being drawn, which turns a
 * full webfont into a few hundred bytes — that is what makes it reasonable to
 * set a list of eighty families each in its own type.
 *
 * The frames are a separate concern: they get the committed faces from the
 * theme's own `<link>`, and a previewed one from the font draft.
 */
export function requestPreviewFace(
  family: string,
  google: string | true | undefined,
  text = family,
): void {
  if (!google || requested.has(family)) return;
  requested.add(family);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = googleFontUrl(google, family, text);
  document.head.appendChild(link);
}
