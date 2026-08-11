import type { Node, Page } from "@velloo/schema";
import type { Manifest } from "@velloo/shadcn-snapshot";
import { create } from "zustand";
import { type DesignSummary, fetchComponents, fetchDesign, fetchPage } from "./api.ts";
import { pathFromString } from "./path.ts";

export interface Selection {
  variantId: string;
  path: string;
}

export interface CanvasState {
  design: DesignSummary | null;
  currentPageId: string | null;
  currentPage: Page | null;
  /** Bumped whenever currentPage content changes. Used to cache-bust iframe src. */
  pageVersion: number;
  components: Manifest | null;
  selection: Selection | null;
  hover: Selection | null;
  wsConnected: boolean;

  loadDesign(): Promise<void>;
  refreshDesignSummary(): Promise<void>;
  loadComponents(): Promise<void>;
  selectPage(pageId: string): Promise<void>;
  refreshCurrentPage(): Promise<void>;
  setSelection(s: Selection | null): void;
  setHover(h: Selection | null): void;
  setWsConnected(b: boolean): void;
}

/** Walk the current page tree and return the node at the given selection. */
export function selectedNode(page: Page | null, sel: Selection | null): Node | null {
  if (!page || !sel) return null;
  const variant = page.variants.find((v) => v.id === sel.variantId);
  if (!variant) return null;
  const path = pathFromString(sel.path);
  let node: Node | undefined = variant.tree;
  for (const idx of path) {
    if (!node?.children || idx < 0 || idx >= node.children.length) return null;
    node = node.children[idx];
  }
  return node ?? null;
}

export const useCanvas = create<CanvasState>((set, get) => ({
  design: null,
  currentPageId: null,
  currentPage: null,
  pageVersion: 0,
  components: null,
  selection: null,
  hover: null,
  wsConnected: false,

  async loadDesign() {
    const design = await fetchDesign();
    set({ design });
    const next = get().currentPageId ?? design.pages[0]?.id ?? null;
    if (next) await get().selectPage(next);
  },

  async refreshDesignSummary() {
    const design = await fetchDesign();
    set({ design });
  },

  async loadComponents() {
    if (get().components) return;
    set({ components: await fetchComponents() });
  },

  async selectPage(pageId: string) {
    const page = await fetchPage(pageId);
    set({
      currentPageId: pageId,
      currentPage: page,
      pageVersion: get().pageVersion + 1,
      selection: null,
      hover: null,
    });
  },

  async refreshCurrentPage() {
    const id = get().currentPageId;
    if (!id) return;
    try {
      const page = await fetchPage(id);
      set({ currentPage: page, pageVersion: get().pageVersion + 1 });
    } catch {
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
