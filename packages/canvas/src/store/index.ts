import { create } from "zustand";
import { type ActivitySlice, createActivitySlice } from "./activity.ts";
import { type AnnotationsSlice, createAnnotationsSlice } from "./annotations.ts";
import { createDesignSlice, type DesignSlice } from "./design.ts";
import { createInspectorSlice, type InspectorSlice } from "./inspector.ts";
import { createLibrarySlice, type LibrarySlice } from "./library.ts";
import { createModesSlice, type ModesSlice } from "./modes.ts";
import { createSelectionSlice, type SelectionSlice } from "./selection.ts";
import { createViewportSlice, type ViewportSlice } from "./viewport.ts";

/**
 * One zustand store composed from feature-grouped slices. Each slice owns a
 * concern's state + actions but is created against the full {@link CanvasState},
 * so cross-slice reads/writes (selectScreen clearing annotations, cursor-mode
 * changes clearing selection) stay one plain `set`/`get` away — no events, no
 * duplicated state.
 *
 *   - design      — server data: design summary, boards/screens, theme, history
 *   - selection   — selected + hovered node
 *   - viewport    — zoom / pan / cursor tool / reported frame geometry
 *   - modes       — app theme, design light/dark, persisted panel collapse
 *   - inspector   — right-panel tab + previewed node state
 *   - library     — boards ↔ library ↔ snippet-editor view switching
 *   - annotations — node annotations + board sticky notes
 *   - activity    — agent-activity events: indicator, highlights, feed
 */
export type CanvasState = DesignSlice &
  SelectionSlice &
  ViewportSlice &
  ModesSlice &
  InspectorSlice &
  LibrarySlice &
  AnnotationsSlice &
  ActivitySlice;

export const useCanvas = create<CanvasState>()((...a) => ({
  ...createDesignSlice(...a),
  ...createSelectionSlice(...a),
  ...createViewportSlice(...a),
  ...createModesSlice(...a),
  ...createInspectorSlice(...a),
  ...createLibrarySlice(...a),
  ...createAnnotationsSlice(...a),
  ...createActivitySlice(...a),
}));
