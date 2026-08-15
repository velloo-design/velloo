import { useEffect, useRef } from "react";
import type { LibraryItemRef, ViewMode } from "./store.ts";
import { useCanvas } from "./store.ts";

interface UrlState {
  view: ViewMode;
  libraryItem: LibraryItemRef | null;
  boardId: string | null;
  screenId: string | null;
  selection: { screenId: string; path: string } | null;
  snippetId: string | null;
}

export function readUrlState(): UrlState {
  const params = new URLSearchParams(window.location.search);
  const rawView = params.get("view");
  const view: ViewMode =
    rawView === "library" ? "library" : rawView === "snippet" ? "snippet" : "boards";
  const itemRaw = params.get("item");
  let libraryItem: LibraryItemRef | null = null;
  if (view === "library" && itemRaw) {
    const [kind, ...rest] = itemRaw.split(":");
    if ((kind === "component" || kind === "snippet") && rest.length > 0) {
      libraryItem = { kind, id: rest.join(":") };
    }
  }
  const boardId = params.get("board");
  const screenId = params.get("screen");
  const selPath = params.get("sel");
  const selection = screenId && selPath !== null ? { screenId, path: selPath } : null;
  const snippetId = view === "snippet" ? params.get("snippet") : null;
  return { view, libraryItem, boardId, screenId, selection, snippetId };
}

function writeUrl(
  view: ViewMode,
  libraryItem: LibraryItemRef | null,
  boardId: string | null,
  screenId: string | null,
  sel: { screenId: string; path: string } | null,
  editingSnippetId: string | null,
  pushBoard: boolean,
): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("view");
  url.searchParams.delete("item");
  url.searchParams.delete("board");
  url.searchParams.delete("screen");
  url.searchParams.delete("sel");
  url.searchParams.delete("snippet");
  if (view === "snippet" && editingSnippetId) {
    url.searchParams.set("view", "snippet");
    url.searchParams.set("snippet", editingSnippetId);
  } else if (view === "library") {
    url.searchParams.set("view", "library");
    if (libraryItem) url.searchParams.set("item", `${libraryItem.kind}:${libraryItem.id}`);
  } else {
    if (boardId) url.searchParams.set("board", boardId);
    if (screenId) url.searchParams.set("screen", screenId);
    if (sel) url.searchParams.set("sel", sel.path);
  }
  if (pushBoard) {
    window.history.pushState({}, "", url.toString());
  } else {
    window.history.replaceState({}, "", url.toString());
  }
}

function itemKey(item: LibraryItemRef | null): string {
  return item ? `${item.kind}:${item.id}` : "";
}

export function useUrlState(): void {
  const view = useCanvas((s) => s.view);
  const libraryItem = useCanvas((s) => s.libraryItem);
  const currentBoardId = useCanvas((s) => s.currentBoardId);
  const currentScreenId = useCanvas((s) => s.currentScreenId);
  const selection = useCanvas((s) => s.selection);
  const editingSnippetId = useCanvas((s) => s.editingSnippetId);
  // Track previous board / view / library item so we know when to push vs
  // replace. Pushing on every state shuffle would spam history; replacing
  // on a navigation-shaped change would break the browser back button.
  const lastBoardRef = useRef<string | null | undefined>(undefined);
  const lastViewRef = useRef<ViewMode | undefined>(undefined);
  const lastItemKeyRef = useRef<string | undefined>(undefined);
  const restoringRef = useRef(false);

  useEffect(() => {
    if (restoringRef.current) {
      restoringRef.current = false;
      lastBoardRef.current = currentBoardId;
      lastViewRef.current = view;
      lastItemKeyRef.current = itemKey(libraryItem);
      return;
    }
    const prevBoard = lastBoardRef.current;
    const prevView = lastViewRef.current;
    const prevItem = lastItemKeyRef.current;
    const nextItem = itemKey(libraryItem);
    const pushBoard =
      view === "boards" && Boolean(prevBoard && currentBoardId && prevBoard !== currentBoardId);
    const pushView = prevView !== undefined && prevView !== view;
    // Pushing on item change is what makes the browser back button return
    // from a component detail to the library home — without it, every
    // sidebar click is a replaceState and history collapses to one entry.
    const pushItem = view === "library" && prevItem !== undefined && prevItem !== nextItem;
    lastBoardRef.current = currentBoardId;
    lastViewRef.current = view;
    lastItemKeyRef.current = nextItem;
    writeUrl(
      view,
      libraryItem,
      currentBoardId,
      currentScreenId,
      selection,
      editingSnippetId,
      pushBoard || pushView || pushItem,
    );
  }, [view, libraryItem, currentBoardId, currentScreenId, selection, editingSnippetId]);

  useEffect(() => {
    const onPop = () => {
      const state = readUrlState();
      const store = useCanvas.getState();
      restoringRef.current = true;
      const tasks: Promise<unknown>[] = [];
      if (state.view !== store.view) {
        if (state.view === "snippet" && state.snippetId) {
          store.openSnippetEditor(state.snippetId);
        } else if (state.view === "library") {
          store.openLibrary(state.libraryItem);
        } else {
          if (store.editingSnippetId) store.closeSnippetEditor();
          else store.closeLibrary();
        }
      } else if (state.view === "library") {
        store.openLibrary(state.libraryItem);
      } else if (state.view === "snippet" && state.snippetId) {
        store.openSnippetEditor(state.snippetId);
      }
      if (state.view === "boards") {
        if (state.boardId && state.boardId !== store.currentBoardId) {
          tasks.push(store.selectBoard(state.boardId));
        }
        if (state.screenId && state.screenId !== store.currentScreenId) {
          tasks.push(store.selectScreen(state.screenId));
        }
      }
      void Promise.all(tasks).then(() => {
        if (state.view === "boards") store.setSelection(state.selection);
      });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
}
