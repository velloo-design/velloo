/**
 * Route-path → screen id/name helpers shared by every scanner (JS
 * frameworks in `routes.ts`, server frameworks in `server-routes.ts`).
 */

export function titleCaseFromSegment(segment: string): string {
  if (segment === "") return "Index";
  if (segment === "index") return "Index";
  // Convert "user-settings" → "User settings", "_id" → "Id".
  const cleaned = segment.replace(/^[_[]+|[\]]+$/g, "").replace(/[-_]+/g, " ");
  if (!cleaned) return segment;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Produce a stable, slug-safe screen id from a route path. Examples:
 *   "/"                    → "index"
 *   "/dashboard"           → "dashboard"
 *   "/settings/account"    → "settings-account"
 *   "/blog/[slug]"         → "blog-slug"
 */
export function idFromRoutePath(routePath: string): string {
  if (routePath === "/" || routePath === "") return "index";
  const out = routePath
    .replace(/^\//, "")
    .replace(/\//g, "-")
    .replace(/[[\]()]/g, "")
    .replace(/^_/, "")
    .replace(/[^a-zA-Z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return out || "index";
}

export function nameFromRoutePath(routePath: string): string {
  if (routePath === "/" || routePath === "") return "Home";
  const segments = routePath.replace(/^\//, "").split("/").map(titleCaseFromSegment);
  return segments.join(" / ");
}
