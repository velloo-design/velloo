import type { Page, Theme } from "@velloo/schema";
import type { Manifest } from "@velloo/shadcn-snapshot";

export interface DesignSummary {
  snapshotVersion: string;
  theme: { name: string };
  pages: PageMeta[];
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
};
