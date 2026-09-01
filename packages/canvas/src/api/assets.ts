import { postJson } from "./http.ts";

/** Mirrors `GeneratedAsset` in @velloo/schema — the folder's assets.json. */
export interface GeneratedAsset {
  prompt: string;
  intent: string;
  aspect?: string;
  width?: number;
  height?: number;
  generatedAt: string;
  reference?: string[];
  replaces?: string;
}

export interface GenerateRequest {
  prompt: string;
  intent: string;
  aspect?: string;
  reference?: string[];
  replaces?: string;
}

export interface GenerateResult {
  assetPath: string;
  url: string;
  intent: string;
  cost: string;
  chargedMicros: number;
  balanceMicros: number;
  width?: number;
  height?: number;
}

/** Provenance for every asset velloo generated in this folder, keyed by path. */
export async function fetchGeneratedAssets(): Promise<Record<string, GeneratedAsset>> {
  const res = await fetch("/api/assets");
  if (!res.ok) throw new Error(`assets: ${res.status}`);
  return ((await res.json()) as { generated: Record<string, GeneratedAsset> }).generated;
}

/**
 * Generate one image against the user's credit balance. Errors carry the
 * cloud's own agent-facing message (sign in, top up, retry), so call-sites
 * should surface it verbatim rather than substituting their own.
 */
export function generateAsset(req: GenerateRequest): Promise<GenerateResult> {
  return postJson<GenerateResult>("/api/assets/generate", req);
}
