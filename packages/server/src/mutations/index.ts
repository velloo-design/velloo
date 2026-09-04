/**
 * Mutation surface for the server. Each lifecycle area lives in its own
 * file under `api/` — this index re-exports them so callers can keep
 * importing from `@/mutations`. Adding a new mutation means: write the
 * impl alongside its peers, add an orchestration wrapper in the right
 * `api/<area>.ts`, and it shows up here automatically.
 */

export {
  type AddAnnotationArgs,
  type AddNoteArgs,
  type AnnotationResult,
  addAnnotation,
  addNote,
  type NoteResult,
  type RemoveAnnotationArgs,
  type RemoveNoteArgs,
  removeAnnotation,
  removeNote,
  type UpdateAnnotationArgs,
  type UpdateNoteArgs,
  updateAnnotation,
  updateNote,
} from "./api/annotations.ts";
export {
  type AddBoardGroupArgs,
  type AddBoardGroupResult,
  addBoardGroup,
  type RemoveBoardGroupArgs,
  type RemoveBoardGroupResult,
  type ReorderBoardGroupsArgs,
  type ReorderBoardGroupsResult,
  removeBoardGroup,
  reorderBoardGroups,
  type UpdateBoardGroupArgs,
  type UpdateBoardGroupResult,
  updateBoardGroup,
} from "./api/board-groups.ts";
export {
  type AddBoardArgs,
  type AddBoardResult,
  addBoard,
  type RemoveBoardArgs,
  type RemoveBoardResult,
  type ReorderBoardsArgs,
  type ReorderBoardsResult,
  removeBoard,
  reorderBoards,
  type UpdateBoardArgs,
  type UpdateBoardResult,
  updateBoard,
} from "./api/boards.ts";
export {
  type UpdateCodegenArgs,
  type UpdateCodegenResult,
  type UpdateDefaultsArgs,
  type UpdateDefaultsResult,
  type UpdateFeedbackArgs,
  type UpdateFeedbackResult,
  type UpdateViewportPresetsArgs,
  type UpdateViewportPresetsResult,
  updateCodegen,
  updateDefaults,
  updateFeedback,
  updateViewportPresets,
} from "./api/config.ts";
export {
  type AddFrameArgs,
  type AddFrameResult,
  addFrame,
  type RemoveFrameArgs,
  type RemoveFrameResult,
  removeFrame,
  type UpdateFrameArgs,
  type UpdateFrameResult,
  type UpdateFramesArgs,
  type UpdateFramesResult,
  updateFrame,
  updateFrames,
} from "./api/frames.ts";
export {
  type AuditSnippetArgs,
  auditSnippet,
  type DarkModeAuditArgs,
  type DarkModeAuditResult,
  darkModeAudit,
  type InspectArgs,
  type InspectResult,
  inspect,
} from "./api/inspect.ts";
export {
  type AddScreenArgs,
  type AddScreenResult,
  addScreen,
  type RemoveScreenArgs,
  type RemoveScreenResult,
  removeScreen,
  type SetScreenTreeArgs,
  type SetScreenTreeResult,
  setScreenTree,
  type UpdateScreenArgs,
  type UpdateScreenResult,
  updateScreen,
} from "./api/screens.ts";
export {
  type AddSnippetArgs,
  type AddSnippetResult,
  addSnippet,
  type InstantiateSnippetArgs,
  type InstantiateSnippetResult,
  instantiateSnippet,
  type RemoveSnippetArgs,
  type RemoveSnippetResult,
  removeSnippet,
  type UpdateSnippetArgs,
  type UpdateSnippetArgsArgs,
  type UpdateSnippetArgsResult,
  type UpdateSnippetResult,
  updateSnippet,
  updateSnippetArgs,
} from "./api/snippets.ts";
export {
  type AddNodeArgs,
  type AddNodeResult,
  type ApplyClassesArgs,
  addNode,
  applyClasses,
  type MoveNodeArgs,
  type MoveNodeResult,
  moveNode,
  type OverrideSnippetPropsArgs,
  type OverrideSnippetPropsResult,
  overrideSnippetProps,
  type RemoveNodeArgs,
  type RemoveNodeResult,
  removeNode,
  type SetNodeIdArgs,
  type SetNodeIdResult,
  setNodeId,
  type UpdatePropsArgs,
  type UpdatePropsBulkArgs,
  type UpdatePropsBulkResult,
  type UpdatePropsResult,
  updateProps,
  updatePropsBulk,
} from "./api/tree.ts";
export type { MutationContext } from "./context.ts";
export type { MutationError } from "./errors.ts";
export {
  type AddExtensionArgs,
  type AddExtensionResult,
  addExtension,
  type RemoveExtensionArgs,
  type RemoveExtensionResult,
  removeExtension,
  type UpdateExtensionArgs,
  type UpdateExtensionResult,
  updateExtension,
} from "./extensions.ts";
export {
  type FindNodesArgs,
  type FindNodesResult,
  type FoundNode,
  findNodes,
} from "./find-nodes.ts";
export {
  type UpdateSnippetInstanceResult,
  updateSnippetInstance,
} from "./update-snippet-instance.ts";
