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
  /**
   * The app this route belongs to, relative to the app root (e.g.
   * "apps/web"). Set only by multi-app scans — a single-app scan leaves it
   * undefined and everything behaves as before.
   */
  appRel?: string;
}

export type Framework =
  | "next-app"
  | "next-pages"
  | "tanstack-router"
  | "vite"
  | "astro"
  | "sveltekit"
  | "nuxt"
  | "django"
  | "flask"
  | "rails"
  | "laravel"
  | "unknown";

export interface ScanResult {
  framework: Framework;
  routes: ScannedRoute[];
  /** Absolute path to the directory that was walked (the routes root). */
  routesRoot: string;
}

/** One scannable app found under the app root (a monorepo has several). */
export interface AppScan {
  /** Absolute directory the routes were scanned from. */
  dir: string;
  /** `dir` relative to the app root ("" when it's the root itself). */
  rel: string;
  framework: Framework;
  /** Routes found in this app (ids are app-prefixed in multi-app scans). */
  routes: ScannedRoute[];
}
