import type { Manifest } from "@velloo/provider";
import type { Board, Screen, Snippet, SnippetParam, Theme, ViewportPreset } from "@velloo/schema";
import type { AnnotationEntry, CanvasNoteEntry } from "../store.ts";
import type { MutateError } from "./http.ts";

export interface DesignSummary {
  snapshotVersion: string;
  /** Provider id for the default library (Sprint Y). */
  providerId?: string;
  /**
   * Multi-library map (Sprint Y). `null` for older builds; `{}` if none
   * registered. Keys are user-chosen library ids (the same string a
   * screen pins via `screen.library`).
   */
  libraries?: Record<string, { providerId: string; version: string }>;
  defaultLibrary?: string | null;
  /** Count of folder-global extensions for sidebar headcount. */
  extensionsCount?: number;
  theme: { name: string };
  defaultScreen: string | null;
  defaultBoard: string | null;
  viewportPresets: ViewportPreset[];
  screens: ScreenMeta[];
  boards: BoardMeta[];
  snippets: SnippetMeta[];
}

export interface ScreenMeta {
  id: string;
  name: string;
  /** Resolved library id (Sprint Y) — falls back to defaultLibrary server-side. */
  library?: string | null;
}

export interface BoardMeta {
  id: string;
  name: string;
  frameCount: number;
}

export interface SnippetMeta {
  id: string;
  name: string;
  params: SnippetParam[];
  /** Resolved library id (Sprint Y). */
  library?: string | null;
}

/** A manifest entry returned by /api/components after Sprint Y. */
export interface ComponentManifestEntry {
  id: string;
  category: string;
  source: string;
  props: { name: string }[];
  designModeNotes?: string;
  kind?: "library" | "extension";
  importPath?: string;
}

/**
 * GET + parse. Failures read the server's `{error: {...}}` envelope and
 * attach the typed payload, same as http.ts's POST helpers — one error
 * shape across the whole API layer.
 */
async function getJson<T>(path: string, label: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: MutateError };
    const err = new Error(body.error?.message ?? `${label}: ${res.status}`);
    (err as Error & { payload?: MutateError }).payload = body.error;
    throw err;
  }
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
  const body = await getJson<{ annotations: AnnotationEntry[] }>(
    `/api/annotations/${encodeURIComponent(screenId)}`,
    `fetchAnnotations(${screenId})`,
  );
  return body.annotations;
}

export async function fetchNotes(boardId: string): Promise<CanvasNoteEntry[]> {
  const body = await getJson<{ notes: CanvasNoteEntry[] }>(
    `/api/notes/${encodeURIComponent(boardId)}`,
    `fetchNotes(${boardId})`,
  );
  return body.notes;
}

export function fetchComponents(): Promise<Manifest> {
  return getJson("/api/components", "fetchComponents");
}

export function fetchTheme(): Promise<Theme> {
  return getJson("/api/theme", "fetchTheme");
}

export function fetchPresets(): Promise<{ presets: string[] }> {
  return getJson("/api/theme/presets", "fetchPresets");
}

export function renderUrl(screenId: string, w: number, h: number, theme?: string): string {
  const themeParam = theme ? `&theme=${encodeURIComponent(theme)}` : "";
  return `/api/render/${encodeURIComponent(screenId)}?w=${w}&h=${h}${themeParam}`;
}
