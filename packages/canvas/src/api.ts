import type { Board, Screen, Snippet, SnippetParam, Theme } from "@velloo/schema";
import type { Manifest } from "@velloo/shadcn-snapshot";
import type { AnnotationEntry, CanvasNoteEntry } from "./store.ts";

export interface DesignSummary {
  snapshotVersion: string;
  theme: { name: string };
  defaultScreen: string | null;
  defaultBoard: string | null;
  screens: ScreenMeta[];
  boards: BoardMeta[];
  snippets: SnippetMeta[];
}

export interface ScreenMeta {
  id: string;
  name: string;
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

export async function fetchComponents(): Promise<Manifest> {
  const res = await fetch("/api/components");
  if (!res.ok) throw new Error(`fetchComponents: ${res.status}`);
  return (await res.json()) as Manifest;
}

export function renderUrl(screenId: string, w: number, h: number): string {
  return `/api/render/${encodeURIComponent(screenId)}?w=${w}&h=${h}`;
}

export interface MutateError {
  code: string;
  message: string;
  path?: number[];
  ref?: string;
  suggestions?: string[];
}

async function postMutate<T>(op: string, args: unknown): Promise<T> {
  const res = await fetch(`/api/mutate/${op}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: MutateError };
    const err = new Error(body.error?.message ?? `mutate/${op}: ${res.status}`);
    (err as Error & { code?: string; payload?: MutateError }).payload = body.error;
    throw err;
  }
  return (await res.json()) as T;
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

async function postTheme<T>(op: string, args: unknown): Promise<T> {
  const res = await fetch(`/api/theme/${op}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message: string } };
    throw new Error(body.error?.message ?? `theme/${op}: ${res.status}`);
  }
  return (await res.json()) as T;
}

export interface HistoryDepths {
  undo: number;
  redo: number;
}
export type RevertedEntry =
  | { kind: "screen"; screenId: string }
  | { kind: "board"; boardId: string }
  | { kind: "theme" }
  | { kind: "snippet"; snippetId: string };
export interface HistoryResponse extends HistoryDepths {
  reverted: RevertedEntry | null;
}

export async function fetchHistory(): Promise<HistoryDepths> {
  const res = await fetch("/api/undo");
  if (!res.ok) throw new Error(`fetchHistory: ${res.status}`);
  return (await res.json()) as HistoryDepths;
}

export async function undo(): Promise<HistoryResponse> {
  const res = await fetch("/api/undo", { method: "POST" });
  if (!res.ok) throw new Error(`undo: ${res.status}`);
  return (await res.json()) as HistoryResponse;
}

export async function redo(): Promise<HistoryResponse> {
  const res = await fetch("/api/undo/redo", { method: "POST" });
  if (!res.ok) throw new Error(`redo: ${res.status}`);
  return (await res.json()) as HistoryResponse;
}

export const theme = {
  setToken(path: string, value: string | number) {
    return postTheme<{ theme: Theme }>("set_token", { path, value });
  },
  applyPreset(presetName: string) {
    return postTheme<{ theme: Theme }>("apply_preset", { presetName });
  },
  deriveFromColor(seedColor: string, name?: string) {
    return postTheme<{ theme: Theme; adjustments: unknown[] }>("derive_palette_from_color", {
      seedColor,
      name,
    });
  },
  matchVibe(description: string, useAi = false) {
    return postTheme<{ theme: Theme; matched: { description: string; source: string } }>(
      "match_vibe",
      { description, useAi },
    );
  },
};

export const mutate = {
  updateFrame(args: {
    boardId: string;
    frameId: string;
    patch: {
      x?: number;
      y?: number;
      w?: number;
      h?: number;
      label?: string | null;
      group?: string | null;
    };
  }) {
    return postMutate<{ frame: unknown }>("update_frame", args);
  },
  updateFrames(args: {
    boardId: string;
    patches: Array<{
      frameId: string;
      patch: {
        x?: number;
        y?: number;
        w?: number;
        h?: number;
        label?: string | null;
        group?: string | null;
      };
    }>;
  }) {
    return postMutate<{ frames: unknown[] }>("update_frames", args);
  },
  addFrame(args: {
    boardId: string;
    screenId: string;
    x?: number;
    y?: number;
    w: number;
    h: number;
    label?: string;
    group?: string;
  }) {
    return postMutate<{ frame: unknown }>("add_frame", args);
  },
  removeFrame(args: { boardId: string; frameId: string }) {
    return postMutate<{ removedFrameId: string }>("remove_frame", args);
  },
  addBoard(args: { name: string; id?: string }) {
    return postMutate<{ boardId: string; board: unknown }>("add_board", args);
  },
  removeBoard(args: { boardId: string }) {
    return postMutate<{ removedBoardId: string }>("remove_board", args);
  },
  updateProps(args: { screenId: string; path: number[]; propPatch: Record<string, unknown> }) {
    return postMutate<{ path: number[] }>("update_props", args);
  },
  applyClasses(args: { screenId: string; path: number[]; classes: string }) {
    return postMutate<{ path: number[] }>("apply_classes", args);
  },
  addNode(args: {
    screenId: string;
    parentPath: number[];
    componentRef: string;
    props?: Record<string, unknown>;
  }) {
    return postMutate<{ path: number[] }>("add_node", args);
  },
  removeNode(args: { screenId: string; path: number[] }) {
    return postMutate<{ removedRef: string }>("remove_node", args);
  },
  addScreen(args: { name: string; id?: string }) {
    return postMutate<{ screenId: string; screen: Screen }>("add_screen", args);
  },
  removeScreen(args: { screenId: string }) {
    return postMutate<{
      removedScreenId: string;
      removedFrames: { boardId: string; frameIds: string[] }[];
    }>("remove_screen", args);
  },
  setNodeId(args: {
    screenId: string;
    path: number[] | string;
    /** Pass null to clear. */
    id: string | null;
  }) {
    return postMutate<{ path: number[]; id: string | null }>("set_node_id", args);
  },
  updateSnippetArgs(args: {
    screenId: string;
    path: number[];
    argPatch: Record<string, unknown>;
  }) {
    return postMutate<{ path: number[] }>("update_snippet_args", args);
  },
  instantiateSnippet(args: {
    screenId: string;
    parentPath: number[];
    snippetId: string;
    args?: Record<string, unknown>;
    index?: number;
  }) {
    return postMutate<{ path: number[] }>("instantiate_snippet", args);
  },
};

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const respBody = (await res.json().catch(() => ({}))) as { error?: MutateError };
    const err = new Error(respBody.error?.message ?? `${path}: ${res.status}`);
    (err as Error & { payload?: MutateError }).payload = respBody.error;
    throw err;
  }
  return (await res.json()) as T;
}

export const annotations = {
  add(args: {
    screenId: string;
    target: { locator: number[] | string };
    body: string;
    position?: { x: number; y: number } | "auto";
    collapsed?: boolean;
  }) {
    return postJson<{ annotation: AnnotationEntry }>("/api/annotations/add", args);
  },
  update(args: {
    screenId: string;
    annotationId: string;
    patch: {
      body?: string;
      position?: { x: number; y: number } | "auto";
      collapsed?: boolean | null;
    };
  }) {
    return postJson<{ annotation: AnnotationEntry }>("/api/annotations/update", args);
  },
  remove(args: { screenId: string; annotationId: string }) {
    return postJson<{ removedId: string }>("/api/annotations/remove", args);
  },
};

export const notes = {
  add(args: { boardId: string; x: number; y: number; width?: number; body: string }) {
    return postJson<{ note: CanvasNoteEntry }>("/api/notes/add", args);
  },
  update(args: {
    boardId: string;
    noteId: string;
    patch: { x?: number; y?: number; width?: number; body?: string };
  }) {
    return postJson<{ note: CanvasNoteEntry }>("/api/notes/update", args);
  },
  remove(args: { boardId: string; noteId: string }) {
    return postJson<{ removedId: string }>("/api/notes/remove", args);
  },
};
