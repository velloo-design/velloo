/**
 * The canvas's HTTP mutation bodies.
 *
 * These schemas used to be declared here and again, differently, as inline MCP
 * `inputSchema` blocks — the two drifted (MCP's `add_node` accepted `emitAs`
 * and a `propPatch` alias this file did not, so a capability existed for
 * agents and not for the canvas). Both surfaces and `batch` now read the same
 * declarations from `@velloo/protocol`; this module re-exports them under the
 * names the route table already uses.
 */
export {
  AddAnnotationBody,
  AddBoardBody,
  AddBoardGroupBody,
  AddFrameBody,
  AddNoteBody,
  ApplyClassesBody,
  MoveFrameBody,
  RemoveAnnotationBody,
  RemoveBoardBody,
  RemoveBoardGroupBody,
  RemoveFrameBody,
  RemoveNoteBody,
  ReorderBoardGroupsBody,
  ReorderBoardsBody,
  SetNodeIdBody,
  UpdateAnnotationBody,
  UpdateBoardBody,
  UpdateBoardGroupBody,
  UpdateCodegenBody,
  UpdateDefaultsBody,
  UpdateDesignNameBody,
  UpdateFeedbackBody,
  UpdateFrameBody,
  UpdateNoteBody,
  UpdatePropsBody,
  UpdateSnippetArgsBody,
  UpdateSnippetBody,
  UpdateViewportPresetsBody,
} from "@velloo/protocol";
