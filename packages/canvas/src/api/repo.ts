import type { ComponentGroup, PropDescriptor } from "@velloo/provider";
import type { RepoComponentRef } from "@velloo/schema";
import { getJson } from "./discovery.ts";

/**
 * The host app's own components, as `/api/repo/*` serves them. Typed here
 * rather than imported from the server: the canvas bundle must not reach into
 * `@velloo/server`, and this is only the public projection of its catalog.
 */

export interface RepoPropDescriptor extends PropDescriptor {
  description?: string | undefined;
  /** Takes a React node — placeable as a nested design node, not a scalar. */
  slot?: boolean | undefined;
  /** False for functions, refs, class instances — values a design can't hold. */
  serializable: boolean;
  constraint?: string | undefined;
  /** Declared by an inherited base (`BoxProps`) rather than the component itself. */
  inherited?: boolean | undefined;
}

interface RepoPreviewState {
  name: string;
  props: Record<string, unknown>;
  source: "story" | "usage" | "manifest";
  at?: string | undefined;
}

export interface RepoCatalogEntry {
  /** What gets placed: the JSX name, qualified (`Mantine.Button`) only on a collision. */
  id: string;
  /** The JSX name the app writes — a node's `$ref`. */
  name: string;
  /** Runtime key (`repo:…`); `repoKey(node.$repo)` equals it for a matching node. */
  key: string;
  identity: RepoComponentRef;
  source: "package" | "local";
  packageName?: string | undefined;
  family: string;
  group?: ComponentGroup | undefined;
  description?: string | undefined;
  props: RepoPropDescriptor[];
  acceptsChildren: boolean;
  parts?: string[] | undefined;
  states: RepoPreviewState[];
  /** Host-relative call sites (`src/App.jsx:134`), most useful first. */
  provenance: string[];
  recipe?: string | undefined;
  styleProps: string[];
  qualifiedBecause?: string | undefined;
  viaFamily?: boolean | undefined;
  proxy?: string | undefined;
}

interface RepoAppSummary {
  app?: string | undefined;
  recipes: string[];
  preview: { kind: string; label: string };
  wrappers: { name: string; at: string }[];
}

export interface RepoCatalogResponse {
  entries: RepoCatalogEntry[];
  apps: RepoAppSummary[];
  warnings: string[];
}

export type RepoFidelity = "exact" | "adapted" | "unstyled" | "proxy" | "unavailable" | "fallback";

export interface RepoDiagnostic {
  /** Catalog id, not the runtime key. */
  id: string;
  status: RepoFidelity;
  code?: string | undefined;
  note?: string | undefined;
  remedy?: string | undefined;
  name?: string | undefined;
  importPath?: string | undefined;
}

export function fetchRepoComponents(): Promise<RepoCatalogResponse> {
  return getJson("/api/repo/components", "fetchRepoComponents");
}

/** Builds the browser bundle for these ids on the daemon — call lazily, never per keystroke. */
export async function fetchRepoStatus(ids: string[]): Promise<RepoDiagnostic[]> {
  if (ids.length === 0) return [];
  const q = ids.map(encodeURIComponent).join(",");
  const body = await getJson<{ diagnostics: RepoDiagnostic[] }>(
    `/api/repo/status?ids=${q}`,
    "fetchRepoStatus",
  );
  return body.diagnostics;
}

export function repoRenderUrl(
  id: string,
  opts: { state?: number; w?: number; h?: number; v?: number; dark?: boolean } = {},
): string {
  const qs = new URLSearchParams();
  qs.set("state", String(opts.state ?? 0));
  qs.set("w", String(opts.w ?? 480));
  qs.set("h", String(opts.h ?? 200));
  if (opts.v !== undefined) qs.set("v", String(opts.v));
  if (opts.dark) qs.set("mode", "dark");
  return `/api/render/repo/${encodeURIComponent(id)}?${qs.toString()}`;
}

/** How the app writes the import: a default export binds its own name. */
export function repoImportLine(entry: Pick<RepoCatalogEntry, "identity" | "family">): string {
  const { importPath, exportName } = entry.identity;
  return exportName === "default"
    ? `import ${entry.family} from "${importPath}";`
    : `import { ${exportName} } from "${importPath}";`;
}
