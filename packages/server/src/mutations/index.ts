/**
 * Mutation surface for the server. Each lifecycle area lives in its own
 * file under `api/` — this index re-exports them so callers can keep
 * importing from `@/mutations`. Adding a new mutation means: write the
 * impl alongside its peers, add an orchestration wrapper in the right
 * `api/<area>.ts`, and it shows up here automatically.
 */

export {
  addAnnotation,
  addNote,
  removeAnnotation,
  removeNote,
  updateAnnotation,
  updateNote,
} from "./api/annotations.ts";
export {
  addBoardGroup,
  removeBoardGroup,
  reorderBoardGroups,
  updateBoardGroup,
} from "./api/board-groups.ts";
export {
  addBoard,
  removeBoard,
  reorderBoards,
  updateBoard,
} from "./api/boards.ts";
export {
  updateCodegen,
  updateDefaults,
  updateFeedback,
  updateViewportPresets,
} from "./api/config.ts";
export { addFrame, moveFrame, removeFrame, updateFrames } from "./api/frames.ts";
export { inspect } from "./api/inspect.ts";
export {
  addScreen,
  removeScreen,
  setScreenTree,
  updateScreen,
} from "./api/screens.ts";
export {
  addSnippet,
  instantiateSnippet,
  removeSnippet,
  updateSnippet,
  updateSnippetArgs,
} from "./api/snippets.ts";
export {
  addNode,
  applyClasses,
  moveNode,
  removeNode,
  setNodeId,
  updateProps,
} from "./api/tree.ts";
export type { MutationContext } from "./context.ts";
export type { MutationError } from "./errors.ts";
export { addExtension, removeExtension, updateExtension } from "./extensions.ts";
export { findNodes } from "./find-nodes.ts";
export { updateSnippetInstance } from "./update-snippet-instance.ts";
