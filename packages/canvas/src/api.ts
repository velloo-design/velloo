/**
 * Canvas → server HTTP surface. Split into per-area modules under
 * `./api/`. This barrel re-exports everything so call-sites can keep
 * importing from `../api.ts`.
 */
export {
  deleteAsset,
  fetchGeneratedAssets,
  fetchIntents,
  type GeneratedAsset,
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
export {
  type CloudCommentAvailability,
  type CloudCommentBlocker,
  type CommentScope,
  type CommentScopeFilter,
  type CommentStatusFilter,
  comments,
  signInClears,
} from "./api/comments.ts";
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
export { downloadExport, type ExportFormat, type ExportMode } from "./api/export.ts";
export {
  fetchHistory,
  type HistoryDepths,
  redo,
  undo,
} from "./api/history.ts";
export { mutate } from "./api/mutate.ts";
export { notes } from "./api/notes.ts";
export {
  type PublishRequest,
  type PublishResult,
  type PublishState,
  type PublishTargets,
  publish,
} from "./api/publish.ts";
export { fetchRevertStatus, type RevertStatus, revertAll } from "./api/revert.ts";
export {
  fetchSearch,
  type SearchBoardHit,
  type SearchResponse,
  type SearchScreenHit,
  type SearchTextHit,
} from "./api/search.ts";
export { onSignInRequired } from "./api/sign-in-gate.ts";
export { type FontSpec, type TypesetSpec, theme } from "./api/theme.ts";
export { fetchUpdateStatus, runUpgrade, type UpdateStatus } from "./api/updates.ts";
