/**
 * Canvas → server HTTP surface. Split into per-area modules under
 * `./api/`. This barrel re-exports everything so call-sites can keep
 * importing from `../api.ts`.
 */
export { annotations } from "./api/annotations.ts";
export {
  deleteAsset,
  fetchGeneratedAssets,
  fetchIntents,
  type GeneratedAsset,
  type GenerateRequest,
  type GenerateResult,
  generateAsset,
  type IntentPrice,
} from "./api/assets.ts";
export {
  type AuthStatus,
  auth,
  type CloudAccount,
  type LoginState,
  loginAttemptSucceeded,
} from "./api/auth.ts";
export { config, type FolderConfig, fetchConfig } from "./api/config.ts";
export {
  type BoardGroupMeta,
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
  type PublishRequest,
  type PublishResult,
  type PublishState,
  type PublishTargets,
  publish,
} from "./api/publish.ts";
export {
  fetchRevertStatus,
  type RevertFile,
  type RevertFileStatus,
  type RevertStatus,
  revertAll,
} from "./api/revert.ts";
export {
  fetchSearch,
  type SearchBoardHit,
  type SearchResponse,
  type SearchScreenHit,
  type SearchTextHit,
} from "./api/search.ts";
export { type FontSpec, type TypesetSpec, theme } from "./api/theme.ts";
