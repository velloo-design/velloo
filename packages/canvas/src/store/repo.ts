import { type RepoComponentRef, repoKey } from "@velloo/schema";
import type { StateCreator } from "zustand";
import type { ComponentDiagnostic } from "../api/fidelity.ts";
import { fetchRepoComponents, fetchRepoStatus, type RepoCatalogResponse } from "../api/repo.ts";
import { StatusCache } from "./fidelity.ts";
import type { CanvasState } from "./index.ts";

/**
 * The host app's own components: the catalog the Library's Repo area browses
 * and the inspector reads a repo node's props from, plus per-component
 * fidelity fetched lazily — `/api/repo/status` builds the browser bundle, so
 * it's asked only for what a surface is actually showing.
 */
export interface RepoSlice {
  repoCatalog: RepoCatalogResponse | null;
  repoCatalogLoading: boolean;
  /**
   * Fidelity by catalog id. `null` means asked and the daemon had nothing to
   * say — recorded so a row that never gets a diagnostic isn't re-asked on
   * every render.
   */
  repoStatus: Record<string, ComponentDiagnostic | null>;

  loadRepoCatalog(): Promise<void>;
  /** Drop the catalog and every cached status, then fetch again if it had been loaded. */
  reloadRepoCatalog(): Promise<void>;
  /** Fetch status for the ids not already known or in flight. */
  loadRepoStatus(ids: string[]): Promise<void>;
  /** Ask again even for known ids — after a frame mounted them and may have found more. */
  refreshRepoStatus(ids: string[]): Promise<void>;
}

export const createRepoSlice: StateCreator<CanvasState, [], [], RepoSlice> = (set, get) => {
  const statuses = new StatusCache();
  // Bumped on reload so a catalog answer for the previous one can't land on
  // top of the invalidated cache.
  let generation = 0;

  return {
    repoCatalog: null,
    repoCatalogLoading: false,
    repoStatus: {},

    async loadRepoCatalog() {
      if (get().repoCatalog || get().repoCatalogLoading) return;
      set({ repoCatalogLoading: true });
      const asked = generation;
      let catalog: RepoCatalogResponse;
      try {
        catalog = await fetchRepoComponents();
      } catch {
        // A daemon without the route, or a catalog build that failed, leaves
        // the Library on its provider shelves rather than breaking it.
        catalog = { entries: [], apps: [], warnings: [] };
      }
      if (asked === generation) set({ repoCatalog: catalog, repoCatalogLoading: false });
    },

    async reloadRepoCatalog() {
      // Nothing has asked for it yet — the next surface that does loads fresh.
      const wasLoaded = get().repoCatalog !== null || get().repoCatalogLoading;
      generation += 1;
      statuses.reset();
      set({ repoCatalog: null, repoCatalogLoading: false, repoStatus: {} });
      if (wasLoaded) await get().loadRepoCatalog();
    },

    async refreshRepoStatus(ids) {
      set((s) => {
        const next = { ...s.repoStatus };
        for (const id of ids) delete next[id];
        return { repoStatus: next };
      });
      await get().loadRepoStatus(ids);
    },

    async loadRepoStatus(ids) {
      await statuses.load(
        ids,
        get().repoStatus,
        async (wanted) => new Map((await fetchRepoStatus(wanted)).map((d) => [d.id, d])),
        (entries) => set((s) => ({ repoStatus: { ...s.repoStatus, ...entries } })),
      );
    },
  };
};

/**
 * The catalog entry a node's `$repo` names. Matched on identity, never on
 * `$ref`: Mantine's `Button` and the provider's `Button` share a JSX name.
 */
export function repoEntryFor(catalog: RepoCatalogResponse | null, ref: RepoComponentRef) {
  if (!catalog) return null;
  const key = repoKey(ref);
  return catalog.entries.find((entry) => entry.key === key) ?? null;
}
