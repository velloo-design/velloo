import { useEffect, useRef } from "react";
import { useCanvas } from "./store.ts";

interface UrlState {
  pageId: string | null;
  selection: { variantId: string; path: string } | null;
}

/** Parse ?page= / ?variant= / ?sel= into a UrlState object. */
export function readUrlState(): UrlState {
  const params = new URLSearchParams(window.location.search);
  const pageId = params.get("page");
  const variantId = params.get("variant");
  const selPath = params.get("sel");
  const selection = variantId && selPath !== null ? { variantId, path: selPath } : null;
  return { pageId, selection };
}

/**
 * Reflect current state into the URL.
 *   - Page changes push a new history entry (so the browser back button
 *     returns to the previously viewed page).
 *   - Selection-only changes replace (browser history shouldn't pile up
 *     entries every time the user clicks a different node).
 */
function writeUrl(
  pageId: string | null,
  sel: { variantId: string; path: string } | null,
  pushPage: boolean,
): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("page");
  url.searchParams.delete("variant");
  url.searchParams.delete("sel");
  if (pageId) url.searchParams.set("page", pageId);
  if (sel) {
    url.searchParams.set("variant", sel.variantId);
    url.searchParams.set("sel", sel.path);
  }
  if (pushPage) {
    window.history.pushState({}, "", url.toString());
  } else {
    window.history.replaceState({}, "", url.toString());
  }
}

export function useUrlState(): void {
  const currentPageId = useCanvas((s) => s.currentPageId);
  const selection = useCanvas((s) => s.selection);
  const lastPageRef = useRef<string | null | undefined>(undefined);
  /** True while we're applying a popstate — skip the next URL write. */
  const restoringRef = useRef(false);

  // Reflect store → URL.
  useEffect(() => {
    if (restoringRef.current) {
      restoringRef.current = false;
      lastPageRef.current = currentPageId;
      return;
    }
    // pushState ONLY when transitioning between two valid page ids. Any other
    // change — initial null→page setup, popstate restore, selection-only —
    // replaces the current entry so the back stack reflects user intent, not
    // boot timing.
    const prev = lastPageRef.current;
    const pushPage = Boolean(prev && currentPageId && prev !== currentPageId);
    lastPageRef.current = currentPageId;
    writeUrl(currentPageId, selection, pushPage);
  }, [currentPageId, selection]);

  // Browser back/forward → store.
  useEffect(() => {
    const onPop = () => {
      const state = readUrlState();
      const store = useCanvas.getState();
      restoringRef.current = true;
      if (state.pageId && state.pageId !== store.currentPageId) {
        void store.selectPage(state.pageId).then(() => {
          store.setSelection(state.selection);
        });
      } else {
        store.setSelection(state.selection);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
}
