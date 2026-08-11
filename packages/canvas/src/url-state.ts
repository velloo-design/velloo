import { useEffect } from "react";
import { useCanvas } from "./store.ts";

/** Parse and apply ?page= and ?sel= from the URL on mount. */
export function readUrlState(): {
  pageId: string | null;
  selection: { variantId: string; path: string } | null;
} {
  const params = new URLSearchParams(window.location.search);
  const pageId = params.get("page");
  const variantId = params.get("variant");
  const selPath = params.get("sel");
  const selection = variantId && selPath !== null ? { variantId, path: selPath } : null;
  return { pageId, selection };
}

/** Reflect current state into the URL search params (no history push). */
function writeUrl(pageId: string | null, sel: { variantId: string; path: string } | null): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("page");
  url.searchParams.delete("variant");
  url.searchParams.delete("sel");
  if (pageId) url.searchParams.set("page", pageId);
  if (sel) {
    url.searchParams.set("variant", sel.variantId);
    url.searchParams.set("sel", sel.path);
  }
  window.history.replaceState({}, "", url.toString());
}

export function useUrlState(): void {
  const currentPageId = useCanvas((s) => s.currentPageId);
  const selection = useCanvas((s) => s.selection);
  useEffect(() => {
    writeUrl(currentPageId, selection);
  }, [currentPageId, selection]);
}
