import type { Page } from "@velloo/schema";

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

export function renderUrl(pageId: string, variantId: string): string {
  return `/api/render/${encodeURIComponent(pageId)}/${encodeURIComponent(variantId)}`;
}
