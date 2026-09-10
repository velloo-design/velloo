/**
 * Public store module. The state itself lives in `store/` as feature-grouped
 * slices (design / selection / viewport / modes / inspector / library /
 * annotations) composed into one zustand store — see `store/index.ts`.
 * Consumers keep importing from here.
 */
export { latestPublishForBoard } from "./store/cloud.ts";
export { type CanvasState, useCanvas } from "./store/index.ts";
export { selectedNode } from "./store/selection.ts";
export type {
  AnnotationEntry,
  AppTheme,
  CanvasNoteEntry,
  CursorMode,
  LibraryItemRef,
  NoteAttachment,
  Selection,
  ViewMode,
} from "./store/types.ts";
