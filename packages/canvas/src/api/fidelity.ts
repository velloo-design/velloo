import type { ComponentFidelity } from "@velloo/protocol";
import { getJson } from "./discovery.ts";

export type { ComponentFidelity };

export interface ComponentDiagnostic {
  /** Catalog id for a repository component, manifest id for a library one. */
  id: string;
  status: ComponentFidelity;
  code?: string | undefined;
  note?: string | undefined;
  remedy?: string | undefined;
  name?: string | undefined;
  importPath?: string | undefined;
  /** A frame mounted it and reported this; otherwise it is only the build check. */
  observed?: boolean | undefined;
}

/**
 * How one library's own components render. Named per library because a
 * multi-library folder's manifest ids are only unique within one; an empty
 * `library` asks about the folder's default.
 */
export function fetchLibraryStatus(library: string, ids: string[]): Promise<ComponentDiagnostic[]> {
  return fetchStatus(
    "/api/components/status",
    ids,
    "fetchLibraryStatus",
    library ? { library } : {},
  );
}

/** Each ask builds a browser bundle on the daemon — call lazily, never per keystroke. */
export async function fetchStatus(
  path: string,
  ids: string[],
  label: string,
  extra: Record<string, string> = {},
): Promise<ComponentDiagnostic[]> {
  if (ids.length === 0) return [];
  const q = [
    `ids=${ids.map(encodeURIComponent).join(",")}`,
    ...Object.entries(extra).map(([k, v]) => `${k}=${encodeURIComponent(v)}`),
  ].join("&");
  const body = await getJson<{ diagnostics: ComponentDiagnostic[] }>(`${path}?${q}`, label);
  return body.diagnostics;
}
