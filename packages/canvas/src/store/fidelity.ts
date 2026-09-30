import type { StateCreator } from "zustand";
import type { DesignSummary } from "../api/discovery.ts";
import { type ComponentDiagnostic, fetchLibraryStatus } from "../api/fidelity.ts";
import type { CanvasState } from "./index.ts";

/**
 * Lazily-fetched per-component fidelity, shared by the repo and library maps.
 * Each ask builds a browser bundle, so a key already known or in flight is
 * never asked again; `null` records "asked, and the daemon had nothing to
 * say" so a row that never gets a diagnostic isn't re-asked on every render.
 */
export class StatusCache {
  private pending = new Set<string>();
  // Bumped on reset so an answer for the invalidated cache can't land on top
  // of the fresh one — and can't clear a pending mark a newer ask now owns.
  private generation = 0;

  reset(): void {
    this.generation += 1;
    this.pending.clear();
  }

  async load(
    keys: string[],
    known: Readonly<Record<string, ComponentDiagnostic | null>>,
    fetch: (keys: string[]) => Promise<Map<string, ComponentDiagnostic>>,
    commit: (entries: Record<string, ComponentDiagnostic | null>) => void,
  ): Promise<void> {
    const wanted = [...new Set(keys)].filter((key) => !(key in known) && !this.pending.has(key));
    if (wanted.length === 0) return;
    for (const key of wanted) this.pending.add(key);
    const asked = this.generation;
    try {
      const byKey = await fetch(wanted);
      if (asked !== this.generation) return;
      commit(Object.fromEntries(wanted.map((key) => [key, byKey.get(key) ?? null])));
    } catch {
      // Leave them unknown and retryable — a transient bundle failure
      // shouldn't pin every row to "no status".
    } finally {
      if (asked === this.generation) for (const key of wanted) this.pending.delete(key);
    }
  }
}

/** The `libraryStatus` key for one library's component. */
export function libraryStatusKey(library: string, id: string): string {
  return `${library}\u0000${id}`;
}

/**
 * The library a screen renders with, as the daemon resolved it — or, with no
 * screen, the folder's default (the Library browses the default's manifest).
 * Empty until the design summary is loaded; the route reads that as the
 * default too.
 */
export function libraryFor(design: DesignSummary | null, screenId?: string): string {
  const screen = screenId ? design?.screens.find((s) => s.id === screenId) : undefined;
  return screen?.library ?? design?.defaultLibrary ?? "";
}

/**
 * How a library's own components render, for the badge on the library detail
 * page and the inspector. Keyed by library AND id: in a multi-library folder
 * `Button` names a different component per library.
 */
export interface FidelitySlice {
  libraryStatus: Record<string, ComponentDiagnostic | null>;
  /** Fetch status for the ids not already known or in flight. */
  loadLibraryStatus(library: string, ids: string[]): Promise<void>;
  /** Forget every verdict — the app's source or the folder's libraries changed. */
  resetLibraryStatus(): void;
}

export const createFidelitySlice: StateCreator<CanvasState, [], [], FidelitySlice> = (set, get) => {
  const cache = new StatusCache();
  return {
    libraryStatus: {},

    async loadLibraryStatus(library, ids) {
      const byKey = new Map(ids.map((id) => [libraryStatusKey(library, id), id]));
      await cache.load(
        [...byKey.keys()],
        get().libraryStatus,
        async (keys) => {
          const asked = keys.map((key) => byKey.get(key) as string);
          const diagnostics = await fetchLibraryStatus(library, asked);
          return new Map(diagnostics.map((d) => [libraryStatusKey(library, d.id), d]));
        },
        (entries) => set((s) => ({ libraryStatus: { ...s.libraryStatus, ...entries } })),
      );
    },

    resetLibraryStatus() {
      cache.reset();
      set({ libraryStatus: {} });
    },
  };
};
