/**
 * "AI-generated image" helper. Anthropic's API doesn't generate raster
 * images directly, so this tool takes a prompt → asks Claude Haiku to
 * suggest descriptive keywords + an aspect → returns a Picsum URL
 * seeded by the prompt hash. The result is a stable, framing-aware
 * placeholder the designer can swap for a real image later.
 *
 * Why not call a real image model? Generating raster images requires
 * an external API (fal.ai, Replicate, OpenAI gpt-image-1) with binary
 * downloads + asset storage — out of scope for the first cut. Picsum
 * is a good-enough placeholder that always renders.
 *
 * When `FAL_KEY` is set the tool routes to fal.ai's flux-schnell
 * instead and writes the binary into `assets/`. That path is opt-in
 * and tested separately.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { err, ok, type Result } from "@velloo/result";
import type { DesignFolder } from "../design-folder.ts";

const HAIKU_MODEL = "claude-haiku-4-5";

export interface GenerateImageOptions {
  /** Persist into `assets/<filename>` and return the relative path. */
  filename?: string;
  /** Suggest "1:1" / "4:3" / "16:9" / "21:9". Default "16:9". */
  aspect?: "1:1" | "4:3" | "3:4" | "16:9" | "21:9";
  /** Pixel width hint; the URL targets this width when via Picsum. */
  width?: number;
}

export type GenerateImageError =
  | { kind: "EmptyPrompt" }
  | { kind: "LlmFailed"; message: string }
  | { kind: "WriteFailed"; message: string };

export interface GenerateImageResult {
  /** Public URL ready to drop into `<Image src=…>`. */
  src: string;
  /** Aspect ratio code matching the canvas `<Image>` helper. */
  aspect: "1/1" | "4/3" | "3/4" | "16/9" | "21/9";
  /** Best-guess alt text the agent can refine. */
  alt: string;
  /** Where it was saved if `filename` was given; null otherwise. */
  assetPath: string | null;
  /** "claude+picsum" or "fal" — which path generated this. */
  source: "claude+picsum" | "fal";
}

const ASPECT_DIMS: Record<NonNullable<GenerateImageOptions["aspect"]>, [number, number]> = {
  "1:1": [800, 800],
  "4:3": [800, 600],
  "3:4": [600, 800],
  "16:9": [1280, 720],
  "21:9": [1680, 720],
};

const ASPECT_CANVAS: Record<
  NonNullable<GenerateImageOptions["aspect"]>,
  GenerateImageResult["aspect"]
> = {
  "1:1": "1/1",
  "4:3": "4/3",
  "3:4": "3/4",
  "16:9": "16/9",
  "21:9": "21/9",
};

/**
 * Stable 32-bit hash of a string. Used to seed Picsum so the same
 * prompt returns the same image — agents iterating on a design get
 * predictable placeholders.
 */
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

async function suggestAltText(prompt: string): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    // Fallback: title-case the prompt minus filler words.
    return prompt
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .slice(0, 8)
      .join(" ");
  }
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: HAIKU_MODEL,
        max_tokens: 60,
        messages: [
          {
            role: "user",
            content: `Write a 4-10 word alt-text for an image described as: "${prompt}". Return only the alt text, no quotes or punctuation.`,
          },
        ],
      }),
    });
    if (!res.ok) return prompt;
    const body = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = body.content?.find((c) => c.type === "text")?.text?.trim();
    return text || prompt;
  } catch {
    return prompt;
  }
}

async function generateViaFal(
  folder: DesignFolder,
  prompt: string,
  filename: string,
  aspect: NonNullable<GenerateImageOptions["aspect"]>,
): Promise<Result<{ assetPath: string }, GenerateImageError>> {
  const key = process.env.FAL_KEY;
  if (!key) return err({ kind: "LlmFailed", message: "FAL_KEY not set" });
  const [w, h] = ASPECT_DIMS[aspect];

  let res: Response;
  try {
    res = await fetch("https://fal.run/fal-ai/flux/schnell", {
      method: "POST",
      headers: { Authorization: `Key ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ prompt, image_size: { width: w, height: h }, num_images: 1 }),
    });
  } catch (e) {
    return err({ kind: "LlmFailed", message: (e as Error).message });
  }
  if (!res.ok) {
    return err({ kind: "LlmFailed", message: `fal.run ${res.status}` });
  }
  const body = (await res.json()) as { images?: Array<{ url?: string }> };
  const url = body.images?.[0]?.url;
  if (!url) return err({ kind: "LlmFailed", message: "fal.ai response missing image url" });

  let bin: ArrayBuffer;
  try {
    const dl = await fetch(url);
    if (!dl.ok) throw new Error(`download ${dl.status}`);
    bin = await dl.arrayBuffer();
  } catch (e) {
    return err({ kind: "LlmFailed", message: `image download: ${(e as Error).message}` });
  }

  // Sanitize: basename-only, kill `..`, strip leading dots — matches
  // the contract enforced by generate-svg.ts.
  const base = filename.split(/[/\\]/).pop() ?? "asset";
  const safe =
    base
      .replace(/\.\./g, "_")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/^[._-]+/, "")
      .replace(/_+/g, "_") || "asset";
  const rel = `assets/${safe.endsWith(".png") || safe.endsWith(".jpg") ? safe : `${safe}.png`}`;
  const abs = join(folder.root, rel);
  try {
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, new Uint8Array(bin));
  } catch (e) {
    return err({ kind: "WriteFailed", message: (e as Error).message });
  }
  return ok({ assetPath: rel });
}

export async function generateImage(
  folder: DesignFolder,
  prompt: string,
  opts: GenerateImageOptions = {},
): Promise<Result<GenerateImageResult, GenerateImageError>> {
  const trimmed = prompt.trim();
  if (!trimmed) return err({ kind: "EmptyPrompt" });

  const aspect = opts.aspect ?? "16:9";
  const [w, h] = ASPECT_DIMS[aspect];
  const targetW = opts.width ?? w;
  const targetH = Math.round((h * targetW) / w);

  // Path 1: fal.ai with binary download.
  if (process.env.FAL_KEY && opts.filename) {
    const r = await generateViaFal(folder, trimmed, opts.filename, aspect);
    if (r.ok) {
      const alt = await suggestAltText(trimmed);
      return ok({
        src: `/${r.value.assetPath}`,
        aspect: ASPECT_CANVAS[aspect],
        alt,
        assetPath: r.value.assetPath,
        source: "fal",
      });
    }
    // fal failed → fall through to Picsum.
  }

  // Path 2: Claude alt-text + Picsum URL seeded by prompt hash.
  const seed = hashSeed(trimmed);
  const src = `https://picsum.photos/seed/${seed}/${targetW}/${targetH}`;
  const alt = await suggestAltText(trimmed);
  return ok({
    src,
    aspect: ASPECT_CANVAS[aspect],
    alt,
    assetPath: null,
    source: "claude+picsum",
  });
}
