import type { Manifest, StyleChannel } from "@velloo/provider";
import type { Board, Screen, Snippet, SnippetParam, Theme, ViewportPreset } from "@velloo/schema";
import type { AnnotationEntry, CanvasNoteEntry } from "../store.ts";
import { toApiError } from "./http.ts";

export interface DesignSummary {
  snapshotVersion: string;
  /** Provider id for the default library. */
  providerId?: string;
  /**
   * Multi-library map. `null` for older builds; `{}` if none
   * registered. Keys are user-chosen library ids (the same string a
   * screen pins via `screen.library`).
   */
  libraries?: Record<string, { providerId: string; version: string }>;
  defaultLibrary?: string | null;
  /** Count of folder-global extensions for sidebar headcount. */
  extensionsCount?: number;
  /** Basename of the design folder — browser tab title prefix. */
  folderName?: string;
  theme: { name: string };
  defaultScreen: string | null;
  defaultBoard: string | null;
  viewportPresets: ViewportPreset[];
  screens: ScreenMeta[];
  /** Live boards, in sidebar order. Archived ones are served separately. */
  boards: BoardMeta[];
  /**
   * Boards the user has filed away, in the same sidebar order. Kept out of
   * `boards` so every existing consumer keeps seeing live boards only.
   * Absent on older daemons.
   */
  archivedBoards?: BoardMeta[];
  /**
   * Sidebar groups of boards, in display order. Absent/empty ⇒ a flat list,
   * which is also every folder that has never used grouping.
   */
  boardGroups?: BoardGroupMeta[];
  snippets: SnippetMeta[];
}

export interface BoardGroupMeta {
  id: string;
  name: string;
  /** CSS color for the group's chip and rail. */
  color?: string | undefined;
}

export interface ScreenMeta {
  id: string;
  name: string;
  /** Resolved library id — falls back to defaultLibrary server-side. */
  library?: string | null | undefined;
}

export interface BoardMeta {
  id: string;
  name: string;
  frameCount: number;
  /** Id of the `boardGroups` entry this board sits under; null = ungrouped. */
  group?: string | null | undefined;
  /** ISO stamp when archived; null/absent = live. */
  archivedAt?: string | null | undefined;
}

export interface SnippetMeta {
  id: string;
  name: string;
  params: SnippetParam[];
  /** Resolved library id. */
  library?: string | null | undefined;
}

/**
 * GET + parse. Failures read the server's `{error: {...}}` envelope and
 * attach the typed payload, same as http.ts's POST helpers — one error
 * shape across the whole API layer.
 */
export async function getJson<T>(path: string, label: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw await toApiError(res, label);
  return (await res.json()) as T;
}

export function fetchDesign(): Promise<DesignSummary> {
  return getJson("/api/design", "fetchDesign");
}

export function fetchScreen(id: string): Promise<Screen> {
  return getJson(`/api/screen/${encodeURIComponent(id)}`, `fetchScreen(${id})`);
}

export function fetchBoard(id: string): Promise<Board> {
  return getJson(`/api/board/${encodeURIComponent(id)}`, `fetchBoard(${id})`);
}

export function fetchSnippet(id: string): Promise<Snippet> {
  return getJson(`/api/snippets/${encodeURIComponent(id)}`, `fetchSnippet(${id})`);
}

export async function fetchAnnotations(screenId: string): Promise<AnnotationEntry[]> {
  const body = await getJson<{ annotations: Omit<AnnotationEntry, "screenId">[] }>(
    `/api/annotations/${encodeURIComponent(screenId)}`,
    `fetchAnnotations(${screenId})`,
  );
  // Server stores annotations per-screen sidecar; stamp screenId for the
  // board-scoped canvas layer that may show several screens at once.
  return body.annotations.map((a) => ({ ...a, screenId }));
}

export async function fetchNotes(boardId: string): Promise<CanvasNoteEntry[]> {
  const body = await getJson<{ notes: CanvasNoteEntry[] }>(
    `/api/notes/${encodeURIComponent(boardId)}`,
    `fetchNotes(${boardId})`,
  );
  return body.notes;
}

export interface ComponentsResponse {
  manifest: Manifest;
  styleChannel: StyleChannel;
  channelsByLibrary: Record<string, StyleChannel>;
}

export function fetchComponents(): Promise<ComponentsResponse> {
  return getJson("/api/components", "fetchComponents");
}

/**
 * The named theme, or the folder default when `name` is absent. A board can pin
 * its own, and the panel edits whatever the board on screen renders with — so
 * reading the default unconditionally would show one theme and write another.
 */
export function fetchTheme(name?: string): Promise<Theme> {
  const q = name && name !== "default" ? `?name=${encodeURIComponent(name)}` : "";
  return getJson(`/api/theme${q}`, "fetchTheme");
}

export function fetchPresets(): Promise<{ presets: string[] }> {
  return getJson("/api/theme/presets", "fetchPresets");
}

export function renderUrl(screenId: string, w: number, h: number, theme?: string): string {
  const themeParam = theme ? `&theme=${encodeURIComponent(theme)}` : "";
  return `/api/render/${encodeURIComponent(screenId)}?w=${w}&h=${h}${themeParam}`;
}
