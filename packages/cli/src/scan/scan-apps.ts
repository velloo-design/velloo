import { relative, resolve, sep } from "node:path";
import { discoverScanRoots } from "./discover.ts";
import { titleCaseFromSegment } from "./route-names.ts";
import { scanAppRoutes } from "./routes.ts";
import type { AppScan, ScannedRoute } from "./types.ts";

/** Slug-safe id fragment from an app's rel dir ("apps/web" → "apps-web"). */
export function appSlug(rel: string): string {
  const slug = rel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "app";
}

/**
 * One short, unique prefix per app for screen ids: the last path segment
 * ("apps/web" → "web"), widened to the full slug when two apps share it.
 */
export function appPrefixes(rels: string[]): Map<string, string> {
  const shortOf = (rel: string) => appSlug(rel.split("/").pop() ?? rel);
  const counts = new Map<string, number>();
  for (const rel of rels) {
    const s = shortOf(rel);
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const out = new Map<string, string>();
  for (const rel of rels) {
    const short = shortOf(rel);
    out.set(rel, (counts.get(short) ?? 0) > 1 ? appSlug(rel) : short);
  }
  return out;
}

export interface AppsScanResult {
  /** Apps that produced at least one route, best-ranked first. */
  apps: AppScan[];
  /** All routes, flat, in app order. Ids are app-prefixed when apps > 1. */
  routes: ScannedRoute[];
}

/**
 * Scan every app under `appRoot` for routes. A plain repo yields one app and
 * routes identical to `scanAppRoutes` (no prefixes, no `appRel`). A monorepo
 * yields one entry per route-bearing app, with screen ids prefixed per app
 * ("web-dashboard") so they stay unique across the shared design folder, and
 * names prefixed ("Web / Dashboard") so the picker + boards read clearly.
 * An explicit `scanDir` bypasses discovery and scans only that directory.
 */
export async function scanApps(appRoot: string, scanDir?: string): Promise<AppsScanResult> {
  let roots: { dir: string; rel: string }[];
  if (scanDir?.trim()) {
    const dir = resolve(appRoot, scanDir.trim());
    roots = [{ dir, rel: relative(appRoot, dir).split(sep).join("/") }];
  } else {
    roots = await discoverScanRoots(appRoot);
  }
  if (roots.length === 0) roots.push({ dir: appRoot, rel: "" });

  const apps: AppScan[] = [];
  for (const root of roots) {
    const { framework, routes } = await scanAppRoutes(root.dir);
    if (routes.length === 0) continue;
    apps.push({ dir: root.dir, rel: root.rel, framework, routes });
  }

  if (apps.length > 1) {
    const prefixes = appPrefixes(apps.map((a) => a.rel));
    for (const app of apps) {
      const prefix = prefixes.get(app.rel) ?? appSlug(app.rel);
      const label = titleCaseFromSegment(prefix);
      app.routes = app.routes.map((r) => ({
        ...r,
        id: `${prefix}-${r.id}`,
        name: `${label} / ${r.name}`,
        appRel: app.rel,
      }));
    }
  }

  return { apps, routes: apps.flatMap((a) => a.routes) };
}

/**
 * The app that should drive host detection, theme import, and
 * `config.hostApp`: the one contributing the most selected routes (rank
 * order breaks ties — `apps` arrives best-ranked first).
 */
export function primaryApp(apps: AppScan[], selected: ScannedRoute[]): AppScan | null {
  if (apps.length <= 1) return apps[0] ?? null;
  const counts = new Map<string, number>();
  for (const r of selected) {
    const key = r.appRel ?? "";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best: AppScan | null = null;
  let bestCount = -1;
  for (const app of apps) {
    const n = counts.get(app.rel) ?? 0;
    if (n > bestCount) {
      best = app;
      bestCount = n;
    }
  }
  return best;
}
