import { err, ok, type Result } from "@velloo/result";
import type { CloudAuth } from "./cloud.ts";
import { storeAsset } from "./fs.ts";

/**
 * Hosted asset generation: POST /v1/assets/generate on velloo-cloud,
 * metered against the account's credit ledger. The cloud returns the artwork
 * as a base64 data URL; this module decodes it and lands the file in the
 * folder's `assets/` store exactly like `upload_asset` does (same naming, same
 * layout), so the returned `/assets/<name>` URL drops straight into
 * `<Image src>` — or, for SVG, the decoded markup into `<SVG content>`.
 *
 * Every failure maps to ONE agent-facing message: the cloud's `message` fields
 * are written for agents, so they pass through verbatim, plus a one-line hint
 * naming the way out (log in, top up, wait, or author the art locally with
 * `upload_asset`). Nothing here throws across the boundary.
 */

export const IMAGE_SIZES = ["1024x1024", "1536x1024", "1024x1536"] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];
export type GenerateKind = "image" | "svg";

export interface GenerateAssetRequest {
  prompt: string;
  kind: GenerateKind;
  /** Image only; the cloud defaults to 1024x1024. */
  size?: ImageSize;
  /** Filename stem for `assets/<stem>.<png|svg>`; defaults to the generation id. */
  filename?: string;
}

export interface GeneratedAsset {
  assetPath: string;
  url: string;
  bytes: number;
  kind: GenerateKind;
  chargedMicros: number;
  balanceMicros: number;
  /** e.g. "cost $0.25, balance $11.75" — surfaced verbatim in the tool result. */
  cost: string;
  /** Decoded SVG markup, ready for `<SVG content>` (svg only). */
  content?: string;
}

export interface GenerateAssetError {
  kind: "LoggedOut" | "Unreachable" | "CloudRejected" | "BadResponse";
  /** HTTP status for CloudRejected. */
  status?: number;
  /** Complete agent-facing message: cloud text + the actionable hint. */
  message: string;
}

/** Generation can take a while (raster models run tens of seconds). */
const FETCH_TIMEOUT_MS = 120_000;

const AUTHOR_LOCALLY =
  "Hosted generation isn't available on this velloo-cloud server — author the artwork yourself (SVG compositions, rendered gradients/textures) and store it with `upload_asset`.";

/** One-line, actionable follow-up per failure status (appended after the cloud's message). */
const HINTS: Record<number, string> = {
  401: "Run `velloo login` to sign in again, then restart the server.",
  402: "Ask the user to top up credits (or upgrade) before retrying — or author the asset yourself with `upload_asset`.",
  404: AUTHOR_LOCALLY,
  429: "The limit is per-account per minute — wait a minute, then retry.",
  502: "No credits were charged — retry once; if it fails again, author the asset yourself with `upload_asset`.",
  503: AUTHOR_LOCALLY,
};

export function formatDollars(micros: number): string {
  const value = micros / 1_000_000;
  const fixed = value.toFixed(2);
  return Number(fixed) === value ? `$${fixed}` : `$${value}`;
}

interface GenerateResponse {
  id: string;
  kind: GenerateKind;
  dataUrl: string;
  chargedMicros: number;
  balanceMicros: number;
}

function parseSuccess(body: unknown): GenerateResponse | null {
  if (!body || typeof body !== "object") return null;
  const r = body as Record<string, unknown>;
  if (
    typeof r.id !== "string" ||
    (r.kind !== "image" && r.kind !== "svg") ||
    typeof r.dataUrl !== "string" ||
    typeof r.chargedMicros !== "number" ||
    typeof r.balanceMicros !== "number"
  ) {
    return null;
  }
  return {
    id: r.id,
    kind: r.kind,
    dataUrl: r.dataUrl,
    chargedMicros: r.chargedMicros,
    balanceMicros: r.balanceMicros,
  };
}

function cloudMessage(body: unknown, status: number): string {
  if (
    body &&
    typeof body === "object" &&
    typeof (body as { message?: unknown }).message === "string"
  ) {
    return (body as { message: string }).message;
  }
  return `velloo-cloud rejected the generation request (${status}).`;
}

const DATA_URL = /^data:image\/(png|svg\+xml);base64,([A-Za-z0-9+/=\s]+)$/;

/**
 * Defense-in-depth on the cloud's sanitized SVG. Generated markup is remote
 * input that ends up executing-capable in two local spots: inlined into the
 * canvas via `<SVG content>` (dangerouslySetInnerHTML) and served from the
 * canvas origin under /assets/ (script-inert CSP there, see server/index.ts).
 * The cloud sanitizes before returning; this gate REFUSES anything that still
 * looks active rather than trying to repair it — a false positive just means
 * regenerating or authoring locally.
 */
const ACTIVE_SVG = [
  /<\s*script[\s>]/i,
  /<\s*foreignObject[\s>]/i,
  /\son[a-z]+\s*=/i, // onload= / onclick= / …
  /(?:href|src)\s*=\s*["']?\s*(?:javascript:|data:text\/html)/i,
];

export function svgLooksActive(markup: string): boolean {
  return ACTIVE_SVG.some((re) => re.test(markup));
}

export async function generateAsset(
  root: string,
  cloud: CloudAuth,
  req: GenerateAssetRequest,
): Promise<Result<GeneratedAsset, GenerateAssetError>> {
  if (!cloud.token) {
    return err({
      kind: "LoggedOut",
      message:
        "Not signed in to velloo-cloud — run `velloo login`, then restart the server. Until then, author the artwork yourself and store it with `upload_asset`.",
    });
  }

  let res: Response;
  let body: unknown;
  try {
    res = await fetch(`${cloud.url}/v1/assets/generate`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cloud.token}` },
      body: JSON.stringify({
        prompt: req.prompt,
        kind: req.kind,
        ...(req.kind === "image" && req.size ? { size: req.size } : {}),
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    body = await res.json().catch(() => undefined);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err({
      kind: "Unreachable",
      message: `Couldn't reach velloo-cloud (${msg}) — nothing was generated or charged. Check the connection and retry, or author the asset yourself with \`upload_asset\`.`,
    });
  }

  if (!res.ok) {
    const hint = HINTS[res.status];
    return err({
      kind: "CloudRejected",
      status: res.status,
      message: `${cloudMessage(body, res.status)}${hint ? ` ${hint}` : ""}`,
    });
  }

  const payload = parseSuccess(body);
  if (!payload) {
    return err({
      kind: "BadResponse",
      message: "velloo-cloud returned an unexpected response shape for /v1/assets/generate.",
    });
  }
  const match = DATA_URL.exec(payload.dataUrl);
  if (!match) {
    return err({
      kind: "BadResponse",
      message:
        "velloo-cloud returned a data URL this server doesn't understand (expected base64 png or svg).",
    });
  }
  const ext = match[1] === "png" ? "png" : "svg";
  const bytes = Buffer.from(match[2] as string, "base64");
  if (ext === "svg" && svgLooksActive(bytes.toString("utf8"))) {
    return err({
      kind: "BadResponse",
      message:
        "velloo-cloud returned SVG containing active content (script/event handlers) — refusing to store it. Retry the generation, or author the asset yourself with `upload_asset`.",
    });
  }
  const stem = req.filename?.replace(/\.(png|svg)$/i, "") ?? payload.id;
  const stored = await storeAsset(root, `${stem}.${ext}`, bytes);

  return ok({
    ...stored,
    kind: payload.kind,
    chargedMicros: payload.chargedMicros,
    balanceMicros: payload.balanceMicros,
    cost: `cost ${formatDollars(payload.chargedMicros)}, balance ${formatDollars(payload.balanceMicros)}`,
    ...(ext === "svg" ? { content: bytes.toString("utf8") } : {}),
  });
}
