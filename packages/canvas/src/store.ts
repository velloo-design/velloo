import type { Page } from "@velloo/schema";
import { create } from "zustand";
import { type DesignSummary, fetchDesign, fetchPage } from "./api.ts";

export interface Selection {
  variantId: string;
  path: string;
}

export interface CanvasState {
  design: DesignSummary | null;
  currentPageId: string | null;
  currentPage: Page | null;
  selection: Selection | null;
  hover: Selection | null;
  wsConnected: boolean;

  loadDesign(): Promise<void>;
  selectPage(pageId: string): Promise<void>;
  refreshCurrentPage(): Promise<void>;
  setSelection(s: Selection | null): void;
  setHover(h: Selection | null): void;
  setWsConnected(b: boolean): void;
}

export const useCanvas = create<CanvasState>((set, get) => ({
  design: null,
  currentPageId: null,
  currentPage: null,
  selection: null,
  hover: null,
  wsConnected: false,

  async loadDesign() {
    const design = await fetchDesign();
    set({ design });
    const next = get().currentPageId ?? design.pages[0]?.id ?? null;
    if (next) await get().selectPage(next);
  },

  async selectPage(pageId: string) {
    const page = await fetchPage(pageId);
    set({ currentPageId: pageId, currentPage: page, selection: null, hover: null });
  },

  async refreshCurrentPage() {
    const id = get().currentPageId;
    if (!id) return;
    try {
      const page = await fetchPage(id);
      set({ currentPage: page });
    } catch {
      // Page may have been deleted; let loadDesign reconcile.
      await get().loadDesign();
    }
  },

  setSelection(selection) {
    set({ selection });
  },

  setHover(hover) {
    set({ hover });
  },

  setWsConnected(wsConnected) {
    set({ wsConnected });
  },
}));
