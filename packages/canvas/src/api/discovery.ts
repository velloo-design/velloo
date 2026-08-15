import type { Board, Screen, Snippet, SnippetParam, Theme, ViewportPreset } from "@velloo/schema";
import type { Manifest } from "@velloo/shadcn-snapshot";
import type { AnnotationEntry, CanvasNoteEntry } from "../store.ts";

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

export async function fetchDesign(): Promise<DesignSummary> {
  const res = await fetch("/api/design");
  if (!res.ok) throw new Error(`fetchDesign: ${res.status}`);
  return (await res.json()) as DesignSummary;
}

export async function fetchScreen(id: string): Promise<Screen> {
  const res = await fetch(`/api/screen/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`fetchScreen(${id}): ${res.status}`);
  return (await res.json()) as Screen;
}

export async function fetchBoard(id: string): Promise<Board> {
  const res = await fetch(`/api/board/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`fetchBoard(${id}): ${res.status}`);
  return (await res.json()) as Board;
}

export async function fetchSnippet(id: string): Promise<Snippet> {
  const res = await fetch(`/api/snippets/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`fetchSnippet(${id}): ${res.status}`);
  return (await res.json()) as Snippet;
}

export async function fetchAnnotations(screenId: string): Promise<AnnotationEntry[]> {
  const res = await fetch(`/api/annotations/${encodeURIComponent(screenId)}`);
  if (!res.ok) throw new Error(`fetchAnnotations(${screenId}): ${res.status}`);
  const body = (await res.json()) as { annotations: AnnotationEntry[] };
  return body.annotations;
}

export async function fetchNotes(boardId: string): Promise<CanvasNoteEntry[]> {
  const res = await fetch(`/api/notes/${encodeURIComponent(boardId)}`);
  if (!res.ok) throw new Error(`fetchNotes(${boardId}): ${res.status}`);
  const body = (await res.json()) as { notes: CanvasNoteEntry[] };
  return body.notes;
}

export async function fetchComponents(): Promise<Manifest> {
  const res = await fetch("/api/components");
  if (!res.ok) throw new Error(`fetchComponents: ${res.status}`);
  return (await res.json()) as Manifest;
}

export async function fetchTheme(): Promise<Theme> {
  const res = await fetch("/api/theme");
  if (!res.ok) throw new Error(`fetchTheme: ${res.status}`);
  return (await res.json()) as Theme;
}

export async function fetchPresets(): Promise<{ presets: string[] }> {
  const res = await fetch("/api/theme/presets");
  if (!res.ok) throw new Error(`fetchPresets: ${res.status}`);
  return (await res.json()) as { presets: string[] };
}

export function renderUrl(screenId: string, w: number, h: number): string {
  return `/api/render/${encodeURIComponent(screenId)}?w=${w}&h=${h}`;
}
