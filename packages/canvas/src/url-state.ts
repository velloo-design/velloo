import { useEffect, useRef } from "react";
import type { LibraryItemRef, ViewMode } from "./store.ts";
import { useCanvas } from "./store.ts";
import { toastError } from "./toast.ts";

interface UrlState {
  view: ViewMode;
  libraryItem: LibraryItemRef | null;
  boardId: string | null;
  screenId: string | null;
  selection: { screenId: string; path: string } | null;
  snippetId: string | null;
  /** Open on a side pane — `velloo init` lands on the Agent tab. Read once, then dropped. */
  pane: "agent" | null;
}

export function readUrlState(): UrlState {
  const params = new URLSearchParams(window.location.search);
  const rawView = params.get("view");
  const view: ViewMode =
    rawView === "library" || rawView === "snippet" || rawView === "language" ? rawView : "boards";
  const itemRaw = params.get("item");
  let libraryItem: LibraryItemRef | null = null;
  if (view === "library" && itemRaw) {
    const [kind, ...rest] = itemRaw.split(":");
    if ((kind === "component" || kind === "snippet" || kind === "repo") && rest.length > 0) {
      libraryItem = { kind, id: rest.join(":") };
    }
  }
  const boardId = params.get("board");
  const screenId = params.get("screen");
  const selPath = params.get("sel");
  const selection = screenId && selPath !== null ? { screenId, path: selPath } : null;
  const snippetId = view === "snippet" ? params.get("snippet") : null;
  const pane = params.get("pane") === "agent" ? "agent" : null;
  return { view, libraryItem, boardId, screenId, selection, snippetId, pane };
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
  url.searchParams.delete("pane");
  if (view === "snippet" && editingSnippetId) {
    url.searchParams.set("view", "snippet");
    url.searchParams.set("snippet", editingSnippetId);
  } else if (view === "library") {
    url.searchParams.set("view", "library");
    if (libraryItem) url.searchParams.set("item", `${libraryItem.kind}:${libraryItem.id}`);
  } else if (view === "language") {
    url.searchParams.set("view", "language");
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

/** Whether the store already shows what `state` addresses, so arriving there changes nothing. */
function isAt(state: UrlState): boolean {
  const store = useCanvas.getState();
  return (
    state.view === store.view &&
    state.view === "boards" &&
    (!state.boardId || state.boardId === store.currentBoardId) &&
    (!state.screenId || state.screenId === store.currentScreenId)
  );
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
    const arrive = (state: UrlState) => {
      const store = useCanvas.getState();
      const tasks: Promise<unknown>[] = [];
      if (state.view !== store.view) {
        if (state.view === "snippet" && state.snippetId) {
          store.openSnippetEditor(state.snippetId);
        } else if (state.view === "library") {
          store.openLibrary(state.libraryItem);
        } else if (state.view === "language") {
          tasks.push(
            store
              .openLanguage()
              .catch((err) => toastError(err, "Could not open the design language")),
          );
        } else if (store.editingSnippetId) {
          store.closeSnippetEditor();
        } else {
          store.closeLibrary();
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

    const onPop = () => {
      const state = readUrlState();
      restoringRef.current = true;
      if (useCanvas.getState().view !== "language" || state.view === "language") {
        arrive(state);
        return;
      }
      // Back out of the stage is Cancel, not Done: only Done keeps its edits,
      // and only Done pins the board to a theme made for the visit.
      void (async () => {
        try {
          await useCanvas.getState().cancelLanguage();
        } catch (err) {
          toastError(err, "Could not undo the changes");
          return;
        }
        // Still up: a Done already under way failed, and said so itself.
        if (useCanvas.getState().view === "language") return;
        // Leaving the stage was itself a navigation the URL effect has taken
        // as this restore; whatever is left to change is part of it too.
        if (!isAt(state)) restoringRef.current = true;
        arrive(state);
      })();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
}
