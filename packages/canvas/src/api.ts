/**
 * Canvas → server HTTP surface. Split into per-area modules under
 * `./api/`. This barrel re-exports everything so call-sites can keep
 * importing from `../api.ts`.
 */
export { annotations } from "./api/annotations.ts";
export { type AuthStatus, auth } from "./api/auth.ts";
export {
  type BoardMeta,
  type DesignSummary,
  fetchAnnotations,
  fetchBoard,
  fetchComponents,
  fetchDesign,
  fetchNotes,
  fetchPresets,
  fetchScreen,
  fetchSnippet,
  fetchTheme,
  renderUrl,
  type ScreenMeta,
  type SnippetMeta,
} from "./api/discovery.ts";
export {
  downloadExport,
  type ExportFormat,
  type ExportMode,
  type ExportRequest,
} from "./api/export.ts";
export {
  fetchHistory,
  type HistoryDepths,
  type HistoryResponse,
  type RevertedEntry,
  redo,
  undo,
} from "./api/history.ts";
export type { MutateError } from "./api/http.ts";
export { mutate } from "./api/mutate.ts";
export { notes } from "./api/notes.ts";
export {
  fetchSearch,
  type SearchBoardHit,
  type SearchResponse,
  type SearchScreenHit,
  type SearchTextHit,
} from "./api/search.ts";
export { theme } from "./api/theme.ts";
