import type { Page, Snippet, SnippetParam, Theme } from "@velloo/schema";
import type { Manifest } from "@velloo/shadcn-snapshot";
import type { AnnotationEntry, CanvasNoteEntry } from "./store.ts";

export interface DesignSummary {
  snapshotVersion: string;
  theme: { name: string };
  /** Page id the canvas should focus first; null when the config didn't set one. */
  defaultPage: string | null;
  pages: PageMeta[];
  snippets: SnippetMeta[];
}

export interface PageMeta {
  id: string;
  name: string;
  variants: VariantMeta[];
}

export interface VariantMeta {
  id: string;
  name: string;
  viewport: { w: number; h: number };
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

export async function fetchAnnotations(pageId: string): Promise<AnnotationEntry[]> {
  const res = await fetch(`/api/annotations/${encodeURIComponent(pageId)}`);
  if (!res.ok) throw new Error(`fetchAnnotations(${pageId}): ${res.status}`);
  const body = (await res.json()) as { annotations: AnnotationEntry[] };
  return body.annotations;
}

export async function fetchNotes(pageId: string): Promise<CanvasNoteEntry[]> {
  const res = await fetch(`/api/notes/${encodeURIComponent(pageId)}`);
  if (!res.ok) throw new Error(`fetchNotes(${pageId}): ${res.status}`);
  const body = (await res.json()) as { notes: CanvasNoteEntry[] };
  return body.notes;
}

export async function fetchDesign(): Promise<DesignSummary> {
  const res = await fetch("/api/design");
  if (!res.ok) throw new Error(`fetchDesign: ${res.status}`);
  return (await res.json()) as DesignSummary;
}

export async function fetchPage(id: string): Promise<Page> {
  const res = await fetch(`/api/page/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`fetchPage(${id}): ${res.status}`);
  return (await res.json()) as Page;
}

export async function fetchComponents(): Promise<Manifest> {
  const res = await fetch("/api/components");
  if (!res.ok) throw new Error(`fetchComponents: ${res.status}`);
  return (await res.json()) as Manifest;
}

export function renderUrl(pageId: string, variantId: string): string {
  return `/api/render/${encodeURIComponent(pageId)}/${encodeURIComponent(variantId)}`;
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
export type RevertedEntry = { kind: "page"; pageId: string } | { kind: "theme" };
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
  updateVariant(args: {
    pageId: string;
    variantId: string;
    patch: {
      name?: string;
      viewport?: { w: number; h: number };
      position?: { x: number; y: number } | null;
    };
  }) {
    return postMutate<{ variant: unknown }>("update_variant", args);
  },
  updateVariants(args: {
    pageId: string;
    patches: Array<{
      variantId: string;
      patch: {
        name?: string;
        viewport?: { w: number; h: number };
        position?: { x: number; y: number } | null;
      };
    }>;
  }) {
    return postMutate<{ variants: unknown[] }>("update_variants", args);
  },
  updateProps(args: {
    pageId: string;
    variantId: string;
    path: number[];
    propPatch: Record<string, unknown>;
  }) {
    return postMutate<{ path: number[] }>("update_props", args);
  },
  applyClasses(args: { pageId: string; variantId: string; path: number[]; classes: string }) {
    return postMutate<{ path: number[] }>("apply_classes", args);
  },
  addNode(args: {
    pageId: string;
    variantId: string;
    parentPath: number[];
    componentRef: string;
    props?: Record<string, unknown>;
  }) {
    return postMutate<{ path: number[] }>("add_node", args);
  },
  removeNode(args: { pageId: string; variantId: string; path: number[] }) {
    return postMutate<{ removedRef: string }>("remove_node", args);
  },
  removeVariant(args: { pageId: string; variantId: string }) {
    return postMutate<{ removedVariantId: string }>("remove_variant", args);
  },
  addPage(args: { name: string; id?: string; viewport?: { w: number; h: number } }) {
    return postMutate<{ pageId: string; page: Page }>("add_page", args);
  },
  removePage(args: { pageId: string }) {
    return postMutate<{ removedPageId: string }>("remove_page", args);
  },
  setNodeId(args: {
    pageId: string;
    variantId: string;
    path: number[] | string;
    /** Pass null to clear. */
    id: string | null;
  }) {
    return postMutate<{ path: number[]; id: string | null }>("set_node_id", args);
  },
  updateSnippetArgs(args: {
    pageId: string;
    variantId: string;
    path: number[];
    argPatch: Record<string, unknown>;
  }) {
    return postMutate<{ path: number[] }>("update_snippet_args", args);
  },
  instantiateSnippet(args: {
    pageId: string;
    variantId: string;
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
    pageId: string;
    target: { variantId: string; locator: number[] | string };
    body: string;
    position?: { x: number; y: number } | "auto";
    collapsed?: boolean;
  }) {
    return postJson<{ annotation: AnnotationEntry }>("/api/annotations/add", args);
  },
  update(args: {
    pageId: string;
    annotationId: string;
    patch: {
      body?: string;
      position?: { x: number; y: number } | "auto";
      collapsed?: boolean | null;
    };
  }) {
    return postJson<{ annotation: AnnotationEntry }>("/api/annotations/update", args);
  },
  remove(args: { pageId: string; annotationId: string }) {
    return postJson<{ removedId: string }>("/api/annotations/remove", args);
  },
};

export const notes = {
  add(args: { pageId: string; x: number; y: number; width?: number; body: string }) {
    return postJson<{ note: CanvasNoteEntry }>("/api/notes/add", args);
  },
  update(args: {
    pageId: string;
    noteId: string;
    patch: { x?: number; y?: number; width?: number; body?: string };
  }) {
    return postJson<{ note: CanvasNoteEntry }>("/api/notes/update", args);
  },
  remove(args: { pageId: string; noteId: string }) {
    return postJson<{ removedId: string }>("/api/notes/remove", args);
  },
};
