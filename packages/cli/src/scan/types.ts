/**
 * Result of scanning a host app for routes. The route id is what we
 * use as the screen id (`/dashboard` → `dashboard`). The original path
 * is preserved for the placeholder label so the agent can see the
 * route shape the screen was generated from.
 */
export interface ScannedRoute {
  /** Screen id (slug-safe). e.g. "dashboard", "settings-account". */
  id: string;
  /** Display name. e.g. "Dashboard". */
  name: string;
  /** Original route path. e.g. "/dashboard", "/settings/account". */
  routePath: string;
  /** Absolute path to the source file the route was inferred from. */
  sourceFile: string;
}

export type Framework =
  | "next-app"
  | "next-pages"
  | "tanstack-router"
  | "vite"
  | "astro"
  | "unknown";

export interface ScanResult {
  framework: Framework;
  routes: ScannedRoute[];
  /** Absolute path to the directory that was walked (the routes root). */
  routesRoot: string;
}
