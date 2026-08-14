import { useEffect, useRef } from "react";
import { useCanvas } from "./store.ts";

interface UrlState {
  boardId: string | null;
  screenId: string | null;
  selection: { screenId: string; path: string } | null;
}

export function readUrlState(): UrlState {
  const params = new URLSearchParams(window.location.search);
  const boardId = params.get("board");
  const screenId = params.get("screen");
  const selPath = params.get("sel");
  const selection = screenId && selPath !== null ? { screenId, path: selPath } : null;
  return { boardId, screenId, selection };
}

function writeUrl(
  boardId: string | null,
  screenId: string | null,
  sel: { screenId: string; path: string } | null,
  pushBoard: boolean,
): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("board");
  url.searchParams.delete("screen");
  url.searchParams.delete("sel");
  if (boardId) url.searchParams.set("board", boardId);
  if (screenId) url.searchParams.set("screen", screenId);
  if (sel) url.searchParams.set("sel", sel.path);
  if (pushBoard) {
    window.history.pushState({}, "", url.toString());
  } else {
    window.history.replaceState({}, "", url.toString());
  }
}

export function useUrlState(): void {
  const currentBoardId = useCanvas((s) => s.currentBoardId);
  const currentScreenId = useCanvas((s) => s.currentScreenId);
  const selection = useCanvas((s) => s.selection);
  const lastBoardRef = useRef<string | null | undefined>(undefined);
  const restoringRef = useRef(false);

  useEffect(() => {
    if (restoringRef.current) {
      restoringRef.current = false;
      lastBoardRef.current = currentBoardId;
      return;
    }
    const prev = lastBoardRef.current;
    const pushBoard = Boolean(prev && currentBoardId && prev !== currentBoardId);
    lastBoardRef.current = currentBoardId;
    writeUrl(currentBoardId, currentScreenId, selection, pushBoard);
  }, [currentBoardId, currentScreenId, selection]);

  useEffect(() => {
    const onPop = () => {
      const state = readUrlState();
      const store = useCanvas.getState();
      restoringRef.current = true;
      const tasks: Promise<unknown>[] = [];
      if (state.boardId && state.boardId !== store.currentBoardId) {
        tasks.push(store.selectBoard(state.boardId));
      }
      if (state.screenId && state.screenId !== store.currentScreenId) {
        tasks.push(store.selectScreen(state.screenId));
      }
      void Promise.all(tasks).then(() => {
        store.setSelection(state.selection);
      });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
}
