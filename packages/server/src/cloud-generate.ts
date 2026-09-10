import { readFile } from "node:fs/promises";
import { isAbsolute, join, normalize, relative, resolve } from "node:path";
import {
  type CloudError,
  cloudFailure,
  cloudFetch,
  cloudJson,
  describeCloudError,
  GenerateResponseSchema,
  IntentCatalogResponseSchema,
  type IntentPrice,
  insecureCloudUrl,
  invalidRequest,
  loggedOut,
  protocolViolation,
  readFailure,
  unreachable,
} from "@velloo/protocol";
import { err, ok, type Result } from "@velloo/result";
import { svgLooksActive } from "@velloo/schema";
import { recordGeneratedAssets } from "./assets-store.ts";
import { type CloudAuth, currentToken, isSecureCloudUrl } from "./cloud.ts";
import { pngSize, storeAsset } from "./fs.ts";

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
type Intent = (typeof INTENTS)[number];

export const ASPECTS = ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3"] as const;
type Aspect = (typeof ASPECTS)[number];

type GenerateKind = "image" | "svg";

export interface GenerateAssetRequest {
  prompt: string;
  intent: Intent;
  /** Cloud defaults per intent (16:9 for photo, 1:1 for icon/vector, …). */
  aspect?: Aspect | undefined;
  /** Variants to generate, 1..4. Each is charged. */
  count?: number | undefined;
  /**
   * Existing assets to work from, as folder-relative paths ("assets/hero.png")
   * or canvas URLs ("/assets/hero.png"). `edit`/`cutout`/`upscale` require one;
   * `photo`/`illustration`/`graphic` accept them as style guidance.
   */
  reference?: string[] | undefined;
  /** Filename stem for `assets/<stem>.<png|svg>`; defaults to the generation id. */
  filename?: string | undefined;
  /**
   * The asset this generation replaces, recorded in the provenance store.
   * Set by the canvas's regenerate action; agents don't pass it.
   */
  replaces?: string | undefined;
}

interface GeneratedAssetFile {
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

/**
 * Generation fails the same five ways every other cloud call does, so it uses
 * the same union. It used to declare its own — `LoggedOut | Unreachable |
 * CloudRejected | BadResponse | BadRequest` — which was four fifths of
 * `CloudError` under different names, written that way only because the union
 * lived in the CLI where this package could not reach it.
 */
export type GenerateAssetError = CloudError;

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
  // No 401: `cloudFailure` classifies that as `LoggedOut`, which carries its
  // own "run `velloo login`" sentence and never reaches this table.
  402: "Ask the user to top up credits before retrying.",
  404: NOT_AVAILABLE,
  429: "The limit is per-account per minute — wait a minute, then retry.",
  // The cloud's own 502 text already ends with "no credits were charged" —
  // restating it here read as a stutter in the agent-facing message.
  502: "Retry once.",
  503: NOT_AVAILABLE,
};

export function formatDollars(micros: number): string {
  const value = micros / 1_000_000;
  const fixed = value.toFixed(2);
  return Number(fixed) === value ? `$${fixed}` : `$${value}`;
}

/**
 * The agent-facing sentence for a failed generation.
 *
 * Not `describeCloudError`: that renders for a person at a terminal ("run
 * `velloo login`"), while this is read by an agent deciding whether to retry,
 * ask the user for credit, or give up — and the cloud's own `message` fields
 * are already written for that reader, so they pass through verbatim with one
 * hint appended.
 */
export function describeGenerateFailure(error: GenerateAssetError): string {
  // Whether the account was charged is the first thing an agent needs to know
  // before deciding to retry, and a request that never arrived cannot have been.
  if (error.kind === "Unreachable") {
    return `${describeCloudError(error)}. Nothing was generated or charged.`;
  }
  if (error.kind !== "HttpFailure") return describeCloudError(error);
  const hint = HINTS[error.status];
  // The cloud's messages don't reliably end in punctuation, and run together
  // "…as a data URI Fix the arguments" reads as one mangled sentence.
  // `readFailure`'s "unknown" means the cloud sent no message at all (a proxy
  // page, a bare 500) — the status is then the only thing worth saying.
  const detail =
    error.detail === "unknown"
      ? `velloo-cloud rejected the generation request (${error.status}).`
      : error.detail.trimEnd();
  const sentence = /[.!?]$/.test(detail) ? detail : `${detail}.`;
  return hint ? `${sentence} ${hint}` : sentence;
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
    return err(
      invalidRequest(
        `Reference "${ref}" is outside the design folder — pass a folder-relative path like "assets/hero.png".`,
      ),
    );
  }
  const full = resolve(join(root, cleaned));
  const rel = relative(resolve(root), full);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return err(
      invalidRequest(
        `Reference "${ref}" is outside the design folder — pass a folder-relative path like "assets/hero.png".`,
      ),
    );
  }
  const ext = (full.split(".").pop() ?? "").toLowerCase();
  const mime = REFERENCE_MIME[ext];
  if (!mime) {
    return err(
      invalidRequest(
        `Reference "${ref}" isn't a supported image (expected ${Object.keys(REFERENCE_MIME).join(", ")}).`,
      ),
    );
  }
  let bytes: Buffer;
  try {
    bytes = await readFile(full);
  } catch {
    return err(invalidRequest(`Reference "${ref}" doesn't exist in this design folder.`));
  }
  if (bytes.length > MAX_REFERENCE_BYTES) {
    return err(
      invalidRequest(
        `Reference "${ref}" is ${(bytes.length / (1024 * 1024)).toFixed(1)} MB — the limit is ${MAX_REFERENCE_BYTES / (1024 * 1024)} MB. Use a smaller source image.`,
      ),
    );
  }
  return ok(`data:${mime};base64,${bytes.toString("base64")}`);
}

export type { IntentPrice } from "@velloo/protocol";

/**
 * The cloud's live intent catalogue. Read per request rather than cached: the
 * whole reason prices come from the server is that a repricing there — an env
 * override, no deploy — should reach the picker on the next open.
 */
export async function fetchIntentCatalog(
  cloud: CloudAuth,
): Promise<Result<{ intents: IntentPrice[]; maxCount?: number | undefined }, GenerateAssetError>> {
  const token = await currentToken(cloud);
  if (!token) return err(loggedOut("Not signed in to velloo-cloud"));
  if (!isSecureCloudUrl(cloud.url)) return err(insecureCloudUrl(cloud.url));
  return cloudFetch(`${cloud.url}/v1/assets/intents`, IntentCatalogResponseSchema, {
    operation: "reading the generation catalogue",
    token,
    timeoutMs: 10_000,
  });
}

export async function generateAsset(
  root: string,
  cloud: CloudAuth,
  req: GenerateAssetRequest,
): Promise<Result<GeneratedAsset, GenerateAssetError>> {
  const token = await currentToken(cloud);
  if (!token) return err(loggedOut("Not signed in to velloo-cloud"));

  // Never send the bearer token over a cleartext channel (https or loopback only).
  if (!isSecureCloudUrl(cloud.url)) return err(insecureCloudUrl(cloud.url));

  const refPaths = req.reference ?? [];
  if (refPaths.length > MAX_REFERENCES) {
    return err(
      invalidRequest(
        `At most ${MAX_REFERENCES} reference images per generation (got ${refPaths.length}).`,
      ),
    );
  }
  const references: string[] = [];
  for (const ref of refPaths) {
    const encoded = await encodeReference(root, ref);
    if (!encoded.ok) return encoded;
    references.push(encoded.value);
  }

  let res: Response;
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
  } catch (e) {
    return err(unreachable(e, { url: cloud.url }));
  }

  if (!res.ok) {
    const { detail, code } = await readFailure(res);
    // The hint that names the way out is appended when this is rendered
    // (`describeGenerateFailure`), so the cloud's own wording survives intact
    // here for anything that wants to branch on it.
    return err(cloudFailure("generation", res.status, detail, code));
  }

  const parsed = await cloudJson(res, GenerateResponseSchema, "generation");
  if (!parsed.ok) return parsed;
  const payload = parsed.value;

  const stem = req.filename?.replace(/\.(png|svg)$/i, "") ?? payload.id;
  const files: GeneratedAssetFile[] = [];
  for (const [i, asset] of payload.assets.entries()) {
    const match = DATA_URL.exec(asset.dataUrl);
    if (!match) {
      return err(
        protocolViolation(
          "velloo-cloud returned a data URL this server doesn't understand (expected base64 png or svg)",
        ),
      );
    }
    const ext = match[1] === "png" ? "png" : "svg";
    const bytes = Buffer.from(match[2] as string, "base64");
    if (ext === "svg" && svgLooksActive(bytes.toString("utf8"))) {
      return err(
        protocolViolation(
          "velloo-cloud returned SVG containing active content (script/event handlers) — refusing to store it; retry the generation",
        ),
      );
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
