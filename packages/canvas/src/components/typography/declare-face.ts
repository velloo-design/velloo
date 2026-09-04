import type { Theme } from "@velloo/schema";
import type { CatalogFont } from "@velloo/schema/fonts";
import { theme as themeApi } from "../../api.ts";
import { assignSpec, leadFamily } from "./FontsSection.tsx";

/**
 * Get a theme face for a browsed family and return the role to set on the node.
 *
 * A node never names a family directly. Declaring the face on the theme first
 * is what keeps `font-<role>` meaningful: re-point the role later and every node
 * set in it follows, which is the whole reason roles exist. It also puts the
 * webfont in one place — a family named only at a node would never be requested.
 */
export async function declareFace(
  theme: Theme,
  themeName: string,
  font: CatalogFont,
): Promise<string> {
  const faces = theme.typography.fontFamily ?? {};
  // Reuse before declaring: picking Fraunces twice from two nodes should land
  // on one role, not `fraunces` and `fraunces-2`.
  const existing = Object.entries(faces).find(([, stack]) => leadFamily(stack) === font.family);
  if (existing) return existing[0];
  const role = freeRole(faceSlug(font.family), faces);
  await themeApi.setFonts(themeName, [assignSpec(role, font)]);
  return role;
}

/** A family as a role name the schema accepts: `IBM Plex Sans` → `ibm-plex-sans`. */
function faceSlug(family: string): string {
  const slug = family
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return /^[a-z]/.test(slug) ? slug : `font-${slug}`;
}

/** Never re-point a role someone else's nodes are already using. */
function freeRole(base: string, faces: Record<string, string>): string {
  if (!(base in faces)) return base;
  let n = 2;
  while (`${base}-${n}` in faces) n++;
  return `${base}-${n}`;
}
