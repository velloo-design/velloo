import type { Node, Page, Theme } from "@velloo/schema";
import type { Manifest } from "@velloo/shadcn-snapshot";
import { create } from "zustand";
import {
  type DesignSummary,
  fetchComponents,
  fetchDesign,
  fetchHistory,
  fetchPage,
  fetchPresets,
  fetchTheme,
  type HistoryDepths,
} from "./api.ts";
import { pathFromString } from "./path.ts";

export type RightTab = "node" | "theme";
export type CursorMode = "select" | "hand" | "note" | "annotate";
export type NodeState = "default" | "hover" | "focus" | "active" | "disabled";
export type AppTheme = "light" | "dark" | "system";
export type DesignMode = "light" | "dark";

export interface AnnotationEntry {
  id: string;
  target: { variantId: string; locator: number[] | string };
  position: { x: number; y: number } | "auto";
  body: string;
  collapsed?: boolean;
  /** Server-resolved path for the target, or null if dangling. */
  resolved: number[] | null;
}

export interface CanvasNoteEntry {
  id: string;
  x: number;
  y: number;
  width: number;
  body: string;
}

const APP_THEME_KEY = "velloo:appTheme";

function readAppTheme(): AppTheme {
  if (typeof localStorage === "undefined") return "system";
  const raw = localStorage.getItem(APP_THEME_KEY);
  return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
}

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
  theme: Theme | null;
  themeVersion: number;
  presets: string[];
  selection: Selection | null;
  hover: Selection | null;
  wsConnected: boolean;
  rightTab: RightTab;
  /** Independent canvas zoom (1.0 = 100%). */
  canvasZoom: number;
  /** Cursor mode: select clicks nodes; hand pans the canvas. */
  cursorMode: CursorMode;
  /** Pan offset (x, y) applied to the canvas in hand mode. */
  pan: { x: number; y: number };
  /** Forced state for the selected node. */
  nodeState: NodeState;
  /** Canvas chrome theme: explicit light/dark, or follow the OS. */
  appTheme: AppTheme;
  /** When true, prop/class/children edits replay across every variant. */
  syncEdits: boolean;
  /** Server-reported undo/redo stack depths. Drives the TopBar buttons. */
  history: HistoryDepths;
  /** Preview mode passed to the renderer — flips a `.dark` class. */
  designMode: DesignMode;

  // Sprint 11: annotations + canvas notes per page
  annotations: AnnotationEntry[];
  notes: CanvasNoteEntry[];
  /**
   * Per-variant node bounding rects, in iframe-document coordinates. Populated
   * lazily by VariantFrame in response to annotation list changes. Used by
   * AnnotationsLayer to anchor annotations near their target node (rather than
   * at the variant's top-left) and to draw the connector to the node center.
   */
  nodeRects: Record<string, Record<string, { x: number; y: number; w: number; h: number }>>;
  /** Top-bar toggle. When false the canvas hides both layers (data is kept). */
  annotationsVisible: boolean;
  /** Which annotation/note is currently being edited (id); null = none. */
  editingMarkupId: string | null;
  /**
   * Last-clicked annotation; drives the "strong connector" visual and lights
   * the corresponding node selection too. Independent from `editingMarkupId`
   * so the annotation can be focused (connector strong, node selected)
   * without being in edit mode.
   */
  focusedAnnotationId: string | null;

  loadDesign(): Promise<void>;
  refreshHistory(): Promise<void>;
  refreshDesignSummary(): Promise<void>;
  loadComponents(): Promise<void>;
  loadTheme(): Promise<void>;
  refreshTheme(): Promise<void>;
  selectPage(pageId: string): Promise<void>;
  refreshCurrentPage(): Promise<void>;
  setSelection(s: Selection | null): void;
  setHover(h: Selection | null): void;
  setWsConnected(b: boolean): void;
  setRightTab(t: RightTab): void;
  setCanvasZoom(z: number): void;
  setCursorMode(m: CursorMode): void;
  setPan(p: { x: number; y: number }): void;
  setNodeState(s: NodeState): void;
  setAppTheme(t: AppTheme): void;
  setSyncEdits(b: boolean): void;
  setDesignMode(m: DesignMode): void;
  refreshAnnotations(): Promise<void>;
  refreshNotes(): Promise<void>;
  setAnnotationsVisible(b: boolean): void;
  setEditingMarkupId(id: string | null): void;
  setFocusedAnnotationId(id: string | null): void;
  setNodeRects(
    variantId: string,
    rects: { path: string; x: number; y: number; w: number; h: number }[],
  ): void;
}

/** Walk the current page tree and return the node at the given selection. */
export function selectedNode(page: Page | null, sel: Selection | null): Node | null {
  if (!page || !sel) return null;
  const variant = page.variants.find((v) => v.id === sel.variantId);
  if (!variant) return null;
  const path = pathFromString(sel.path);
  let node: Node | undefined = variant.tree;
  for (const idx of path) {
    if (!node || !("$ref" in node)) return null;
    const children: Node[] | undefined = node.children;
    if (!children || idx < 0 || idx >= children.length) return null;
    node = children[idx];
  }
  return node ?? null;
}

export const useCanvas = create<CanvasState>((set, get) => ({
  design: null,
  currentPageId: null,
  currentPage: null,
  pageVersion: 0,
  components: null,
  theme: null,
  themeVersion: 0,
  presets: [],
  selection: null,
  hover: null,
  wsConnected: false,
  rightTab: "node",
  canvasZoom: 0.75,
  cursorMode: "select",
  pan: { x: 0, y: 0 },
  nodeState: "default",
  appTheme: readAppTheme(),
  syncEdits: true,
  history: { undo: 0, redo: 0 },
  designMode: "light",
  annotations: [],
  notes: [],
  nodeRects: {},
  annotationsVisible: true,
  editingMarkupId: null,
  focusedAnnotationId: null,

  async refreshHistory() {
    try {
      const history = await fetchHistory();
      set({ history });
    } catch {
      /* ignore */
    }
  },

  async loadDesign() {
    const design = await fetchDesign();
    set({ design });
    const prefersDefault =
      design.defaultPage && design.pages.some((p) => p.id === design.defaultPage)
        ? design.defaultPage
        : null;
    const next = get().currentPageId ?? prefersDefault ?? design.pages[0]?.id ?? null;
    if (next) await get().selectPage(next);
    await get().loadTheme();
    await get().refreshHistory();
  },

  async refreshDesignSummary() {
    const design = await fetchDesign();
    set({ design });
  },

  async loadComponents() {
    if (get().components) return;
    set({ components: await fetchComponents() });
  },

  async loadTheme() {
    const [theme, { presets }] = await Promise.all([fetchTheme(), fetchPresets()]);
    set({ theme, presets, themeVersion: get().themeVersion + 1 });
  },

  async refreshTheme() {
    const theme = await fetchTheme();
    set({ theme, themeVersion: get().themeVersion + 1 });
  },

  async selectPage(pageId: string) {
    const page = await fetchPage(pageId);
    set({
      currentPageId: pageId,
      currentPage: page,
      pageVersion: get().pageVersion + 1,
      selection: null,
      hover: null,
      annotations: [],
      notes: [],
      nodeRects: {},
      editingMarkupId: null,
    });
    await Promise.all([get().refreshAnnotations(), get().refreshNotes()]);
  },

  async refreshCurrentPage() {
    const id = get().currentPageId;
    if (!id) return;
    try {
      const page = await fetchPage(id);
      set({ currentPage: page, pageVersion: get().pageVersion + 1 });
      // Annotations may have re-resolved (or now be dangling) — refetch.
      await get().refreshAnnotations();
    } catch {
      await get().loadDesign();
    }
  },

  async refreshAnnotations() {
    const id = get().currentPageId;
    if (!id) return;
    try {
      const { fetchAnnotations } = await import("./api.ts");
      const annotations = await fetchAnnotations(id);
      set({ annotations });
    } catch {
      /* ignore */
    }
  },

  async refreshNotes() {
    const id = get().currentPageId;
    if (!id) return;
    try {
      const { fetchNotes } = await import("./api.ts");
      const notes = await fetchNotes(id);
      set({ notes });
    } catch {
      /* ignore */
    }
  },

  setAnnotationsVisible(annotationsVisible) {
    set({ annotationsVisible });
  },

  setEditingMarkupId(editingMarkupId) {
    set({ editingMarkupId });
  },

  setFocusedAnnotationId(focusedAnnotationId) {
    set({ focusedAnnotationId });
  },

  setNodeRects(variantId, rects) {
    set((s) => {
      const next: Record<string, { x: number; y: number; w: number; h: number }> = {};
      for (const r of rects) next[r.path] = { x: r.x, y: r.y, w: r.w, h: r.h };
      return { nodeRects: { ...s.nodeRects, [variantId]: next } };
    });
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

  setRightTab(rightTab) {
    set({ rightTab });
  },

  setCanvasZoom(canvasZoom) {
    // Clamp to a sane range.
    set({ canvasZoom: Math.max(0.1, Math.min(4, canvasZoom)) });
  },

  setCursorMode(cursorMode) {
    // Hand mode has no selection workflow — clear it.
    // Annotate mode arms the next node-click to anchor an annotation; if a
    // selection were carried in from select mode, clicking that same node
    // would be a no-op (selection state unchanged → watcher doesn't fire).
    // Clearing on entry guarantees the next click is the trigger.
    if (cursorMode === "hand" || cursorMode === "annotate") {
      set({ cursorMode, hover: null, selection: null, nodeState: "default" });
    } else {
      set({ cursorMode, hover: null });
    }
  },

  setPan(pan) {
    set({ pan });
  },

  setNodeState(nodeState) {
    set({ nodeState });
  },

  setAppTheme(appTheme) {
    set({ appTheme });
    if (typeof localStorage !== "undefined") localStorage.setItem(APP_THEME_KEY, appTheme);
  },

  setSyncEdits(syncEdits) {
    set({ syncEdits });
  },

  setDesignMode(designMode) {
    set({ designMode });
  },
}));
