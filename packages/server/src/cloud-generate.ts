import { readFile } from "node:fs/promises";
import { isAbsolute, join, normalize, relative, resolve } from "node:path";
import { err, ok, type Result } from "@velloo/result";
import { svgLooksActive } from "@velloo/schema";
import { recordGeneratedAssets } from "./assets-store.ts";
import { type CloudAuth, currentToken, isSecureCloudUrl } from "./cloud.ts";
import { storeAsset } from "./fs.ts";

/**
 * Hosted asset generation: POST /v1/assets/generate on velloo-cloud,
 * metered against the account's credit balance. The caller names an INTENT —
 * what the artwork is for — and the cloud picks the model; that seam is why
 * this module carries no model names or prices, and why nothing here reports
 * which model ran: the intent is the contract, and the cloud must stay free to
 * re-point one at a different checkpoint without a velloo release. The cloud returns each result
 * as a base64 data URL; this module decodes them and lands the files in the
 * folder's `assets/` store exactly like `upload_asset` does (same naming, same
 * layout), so the returned `/assets/<name>` URL goes into `<Image src>` — or,
 * for SVG, the decoded markup into `<SVG content>`. Raster results also carry
 * their pixel `width`/`height`, because `<Image>` fills its parent: without a
 * matching `aspect` (or a sized box) it lays out at zero height, which is the
 * one way a paid, fully successful generation can still show nothing.
 *
 * Every failure maps to ONE agent-facing message: the cloud's `message` fields
 * are written for agents, so they pass through verbatim, plus a one-line hint
 * naming the way out (log in, top up, wait, retry). Nothing here throws across
 * the boundary.
 */

/**
 * What the artwork is for. The cloud owns the intent → model mapping and may
 * change it at any time; only these NAMES are a contract, so this list is
 * deliberately short and stable. An unknown intent is a 400 whose message
 * lists the live catalogue, passed through verbatim.
 */
export const INTENTS = [
  "photo",
  "illustration",
  "graphic",
  "texture",
  "icon",
  "vector",
  "mark",
  "edit",
  "cutout",
  "upscale",
] as const;
export type Intent = (typeof INTENTS)[number];

export const ASPECTS = ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3"] as const;
export type Aspect = (typeof ASPECTS)[number];

export type GenerateKind = "image" | "svg";

export interface GenerateAssetRequest {
  prompt: string;
  intent: Intent;
  /** Cloud defaults per intent (16:9 for photo, 1:1 for icon/vector, …). */
  aspect?: Aspect;
  /** Variants to generate, 1..4. Each is charged. */
  count?: number;
  /**
   * Existing assets to work from, as folder-relative paths ("assets/hero.png")
   * or canvas URLs ("/assets/hero.png"). `edit`/`cutout`/`upscale` require one;
   * `photo`/`illustration`/`graphic` accept them as style guidance.
   */
  reference?: string[];
  /** Filename stem for `assets/<stem>.<png|svg>`; defaults to the generation id. */
  filename?: string;
  /**
   * The asset this generation replaces, recorded in the provenance store.
   * Set by the canvas's regenerate action; agents don't pass it.
   */
  replaces?: string;
}

export interface GeneratedAssetFile {
  assetPath: string;
  url: string;
  bytes: number;
  kind: GenerateKind;
  /** Pixel dimensions (raster only) — what `<Image>` must be sized to. */
  width?: number;
  height?: number;
  /** Decoded SVG markup, ready for `<SVG content>` (svg only). */
  content?: string;
}

export interface GeneratedAsset {
  /** Every stored file, in the order the cloud returned them. */
  assets: GeneratedAssetFile[];
  intent: Intent;
  chargedMicros: number;
  balanceMicros: number;
  /** e.g. "cost $0.12, balance $11.75" — surfaced verbatim in the tool result. */
  cost: string;
  /** Convenience mirror of assets[0], the common single-result case. */
  assetPath: string;
  url: string;
  kind: GenerateKind;
  width?: number;
  height?: number;
  content?: string;
}

export interface GenerateAssetError {
  kind: "LoggedOut" | "Unreachable" | "CloudRejected" | "BadResponse" | "BadRequest";
  /** HTTP status for CloudRejected. */
  status?: number;
  /** Complete agent-facing message: cloud text + the actionable hint. */
  message: string;
}

/** Generation can take a while (raster models run tens of seconds). */
const FETCH_TIMEOUT_MS = 120_000;

/** Reference images travel inline; the cloud caps each at 4 MB. */
const MAX_REFERENCE_BYTES = 4 * 1024 * 1024;
const MAX_REFERENCES = 3;

const REFERENCE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
};

const NOT_AVAILABLE = "Hosted generation isn't available on this velloo-cloud server.";

/** One-line, actionable follow-up per failure status (appended after the cloud's message). */
const HINTS: Record<number, string> = {
  400: "Fix the arguments and retry — nothing was generated or charged.",
  401: "Run `velloo login` to sign in again, then retry.",
  402: "Ask the user to top up credits before retrying.",
  404: NOT_AVAILABLE,
  429: "The limit is per-account per minute — wait a minute, then retry.",
  // The cloud's own 502 text already ends with "no credits were charged" —
  // restating it here read as a stutter in the agent-facing message.
  502: "Retry once.",
  503: NOT_AVAILABLE,
};

/**
 * A PNG's pixel dimensions, straight out of the IHDR chunk (signature, then a
 * length + "IHDR" tag, then two big-endian uint32s). The agent needs these:
 * `<Image>` fills its parent, so a generated asset dropped in without a
 * matching `aspect` renders at zero height — the one way this whole path can
 * "succeed" and still show nothing.
 */
function pngSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 24 || bytes.toString("latin1", 12, 16) !== "IHDR") return null;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

export function formatDollars(micros: number): string {
  const value = micros / 1_000_000;
  const fixed = value.toFixed(2);
  return Number(fixed) === value ? `$${fixed}` : `$${value}`;
}

interface GenerateResponseAsset {
  kind: GenerateKind;
  dataUrl: string;
}

interface GenerateResponse {
  id: string;
  intent: string;
  assets: GenerateResponseAsset[];
  chargedMicros: number;
  balanceMicros: number;
}

function parseSuccess(body: unknown): GenerateResponse | null {
  if (!body || typeof body !== "object") return null;
  const r = body as Record<string, unknown>;
  if (
    typeof r.id !== "string" ||
    typeof r.chargedMicros !== "number" ||
    typeof r.balanceMicros !== "number"
  ) {
    return null;
  }
  const raw = Array.isArray(r.assets)
    ? r.assets
    : // Pre-variant clouds answered with a single top-level kind/dataUrl.
      typeof r.dataUrl === "string"
      ? [{ kind: r.kind, dataUrl: r.dataUrl }]
      : null;
  if (!raw || raw.length === 0) return null;
  const assets: GenerateResponseAsset[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return null;
    const a = entry as Record<string, unknown>;
    if ((a.kind !== "image" && a.kind !== "svg") || typeof a.dataUrl !== "string") return null;
    assets.push({ kind: a.kind, dataUrl: a.dataUrl });
  }
  return {
    id: r.id,
    intent: typeof r.intent === "string" ? r.intent : "",
    assets,
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
// Detector lives in @velloo/schema (shared with the render boundary, codegen
// emit, and the asset store); re-exported so this module's reject gate below
// and existing importers still resolve it from cloud-generate.
export { svgLooksActive };

/**
 * Read a reference image out of the design folder and encode it for transport.
 * Paths are confined to the folder: a reference is agent-supplied and must not
 * become a way to exfiltrate an arbitrary file to the cloud.
 */
async function encodeReference(
  root: string,
  ref: string,
): Promise<Result<string, GenerateAssetError>> {
  // A leading slash is the canvas URL form ("/assets/hero.png"), not a
  // filesystem root — strip it BEFORE the absolute-path check, and let the
  // containment check below be the actual guard.
  const cleaned = ref.replace(/^\/+/, "");
  if (isAbsolute(cleaned) || normalize(cleaned).startsWith("..")) {
    return err({
      kind: "BadRequest",
      message: `Reference "${ref}" is outside the design folder — pass a folder-relative path like "assets/hero.png".`,
    });
  }
  const full = resolve(join(root, cleaned));
  const rel = relative(resolve(root), full);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return err({
      kind: "BadRequest",
      message: `Reference "${ref}" is outside the design folder — pass a folder-relative path like "assets/hero.png".`,
    });
  }
  const ext = (full.split(".").pop() ?? "").toLowerCase();
  const mime = REFERENCE_MIME[ext];
  if (!mime) {
    return err({
      kind: "BadRequest",
      message: `Reference "${ref}" isn't a supported image (expected ${Object.keys(REFERENCE_MIME).join(", ")}).`,
    });
  }
  let bytes: Buffer;
  try {
    bytes = await readFile(full);
  } catch {
    return err({
      kind: "BadRequest",
      message: `Reference "${ref}" doesn't exist in this design folder.`,
    });
  }
  if (bytes.length > MAX_REFERENCE_BYTES) {
    return err({
      kind: "BadRequest",
      message: `Reference "${ref}" is ${(bytes.length / (1024 * 1024)).toFixed(1)} MB — the limit is ${MAX_REFERENCE_BYTES / (1024 * 1024)} MB. Use a smaller source image.`,
    });
  }
  return ok(`data:${mime};base64,${bytes.toString("base64")}`);
}

export async function generateAsset(
  root: string,
  cloud: CloudAuth,
  req: GenerateAssetRequest,
): Promise<Result<GeneratedAsset, GenerateAssetError>> {
  const token = await currentToken(cloud);
  if (!token) {
    return err({
      kind: "LoggedOut",
      message: "Not signed in to velloo-cloud — run `velloo login`, then retry.",
    });
  }

  // Never send the bearer token over a cleartext channel (https or loopback only).
  if (!isSecureCloudUrl(cloud.url)) {
    return err({
      kind: "Unreachable",
      message: `Refusing to send credentials to a non-HTTPS cloud URL (${cloud.url}). Use https:// or a loopback host.`,
    });
  }

  const refPaths = req.reference ?? [];
  if (refPaths.length > MAX_REFERENCES) {
    return err({
      kind: "BadRequest",
      message: `At most ${MAX_REFERENCES} reference images per generation (got ${refPaths.length}).`,
    });
  }
  const references: string[] = [];
  for (const ref of refPaths) {
    const encoded = await encodeReference(root, ref);
    if (!encoded.ok) return encoded;
    references.push(encoded.value);
  }

  let res: Response;
  let body: unknown;
  try {
    res = await fetch(`${cloud.url}/v1/assets/generate`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        prompt: req.prompt,
        intent: req.intent,
        ...(req.aspect ? { aspect: req.aspect } : {}),
        ...(req.count && req.count > 1 ? { count: req.count } : {}),
        ...(references.length > 0 ? { reference: references } : {}),
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    body = await res.json().catch(() => undefined);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err({
      kind: "Unreachable",
      message: `Couldn't reach velloo-cloud (${msg}) — nothing was generated or charged. Check the connection and retry.`,
    });
  }

  if (!res.ok) {
    const hint = HINTS[res.status];
    // The cloud's messages don't reliably end in punctuation, and this one is
    // read by an agent — run together, "...as a data URI Fix the arguments"
    // reads as a single mangled sentence.
    const detail = cloudMessage(body, res.status).trimEnd();
    const sentence = /[.!?]$/.test(detail) ? detail : `${detail}.`;
    return err({
      kind: "CloudRejected",
      status: res.status,
      message: hint ? `${sentence} ${hint}` : sentence,
    });
  }

  const payload = parseSuccess(body);
  if (!payload) {
    return err({
      kind: "BadResponse",
      message: "velloo-cloud returned an unexpected response shape for /v1/assets/generate.",
    });
  }

  const stem = req.filename?.replace(/\.(png|svg)$/i, "") ?? payload.id;
  const files: GeneratedAssetFile[] = [];
  for (const [i, asset] of payload.assets.entries()) {
    const match = DATA_URL.exec(asset.dataUrl);
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
          "velloo-cloud returned SVG containing active content (script/event handlers) — refusing to store it. Retry the generation.",
      });
    }
    // Single results keep the bare stem; variants get -1, -2, … so a caller's
    // `filename` still names the file they asked for in the common case.
    const name = payload.assets.length === 1 ? stem : `${stem}-${i + 1}`;
    const stored = await storeAsset(root, `${name}.${ext}`, bytes);
    files.push({
      ...stored,
      kind: asset.kind,
      ...(ext === "png" ? (pngSize(bytes) ?? {}) : {}),
      ...(ext === "svg" ? { content: bytes.toString("utf8") } : {}),
    });
  }

  // Provenance is what makes a generated image editable later: without the
  // prompt stored beside the design, re-rolling it means reconstructing the
  // prompt from memory. Never fail a paid, already-stored generation over it.
  await recordGeneratedAssets(
    root,
    Object.fromEntries(
      files.map((f) => [
        f.assetPath,
        {
          prompt: req.prompt,
          intent: req.intent,
          ...(req.aspect ? { aspect: req.aspect } : {}),
          ...(f.width && f.height ? { width: f.width, height: f.height } : {}),
          generatedAt: new Date().toISOString(),
          ...(refPaths.length > 0 ? { reference: refPaths } : {}),
          ...(req.replaces ? { replaces: req.replaces } : {}),
        },
      ]),
    ),
  ).catch(() => {});

  const first = files[0] as GeneratedAssetFile;
  return ok({
    assets: files,
    intent: req.intent,
    chargedMicros: payload.chargedMicros,
    balanceMicros: payload.balanceMicros,
    cost: `cost ${formatDollars(payload.chargedMicros)}, balance ${formatDollars(payload.balanceMicros)}`,
    assetPath: first.assetPath,
    url: first.url,
    kind: first.kind,
    ...(first.width && first.height ? { width: first.width, height: first.height } : {}),
    ...(first.content ? { content: first.content } : {}),
  });
}
