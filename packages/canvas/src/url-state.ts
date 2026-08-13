import { useEffect, useRef } from "react";
import { useCanvas } from "./store.ts";

interface UrlState {
  screenId: string | null;
  selection: { screenId: string; path: string } | null;
}

/** Parse ?screen= / ?sel= into a UrlState object. */
export function readUrlState(): UrlState {
  const params = new URLSearchParams(window.location.search);
  const screenId = params.get("screen");
  const selPath = params.get("sel");
  const selection = screenId && selPath !== null ? { screenId, path: selPath } : null;
  return { screenId, selection };
}

function writeUrl(
  screenId: string | null,
  sel: { screenId: string; path: string } | null,
  pushScreen: boolean,
): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("screen");
  url.searchParams.delete("sel");
  if (screenId) url.searchParams.set("screen", screenId);
  if (sel) url.searchParams.set("sel", sel.path);
  if (pushScreen) {
    window.history.pushState({}, "", url.toString());
  } else {
    window.history.replaceState({}, "", url.toString());
  }
}

export function useUrlState(): void {
  const currentScreenId = useCanvas((s) => s.currentScreenId);
  const selection = useCanvas((s) => s.selection);
  const lastScreenRef = useRef<string | null | undefined>(undefined);
  const restoringRef = useRef(false);

  useEffect(() => {
    if (restoringRef.current) {
      restoringRef.current = false;
      lastScreenRef.current = currentScreenId;
      return;
    }
    const prev = lastScreenRef.current;
    const pushScreen = Boolean(prev && currentScreenId && prev !== currentScreenId);
    lastScreenRef.current = currentScreenId;
    writeUrl(currentScreenId, selection, pushScreen);
  }, [currentScreenId, selection]);

  useEffect(() => {
    const onPop = () => {
      const state = readUrlState();
      const store = useCanvas.getState();
      restoringRef.current = true;
      if (state.screenId && state.screenId !== store.currentScreenId) {
        void store.selectScreen(state.screenId).then(() => {
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
