/**
 * Placeholder-image helper. Anthropic's API doesn't generate raster
 * images directly, so this tool takes a prompt → asks Claude Haiku to
 * suggest alt text → returns a Picsum URL seeded by the prompt hash.
 * The result is a stable, framing-aware placeholder.
 *
 * For *intentional* imagery the agent authors the artwork itself (SVG
 * compositions, rendered gradients/textures) and writes it into the
 * folder via the `upload_asset` tool — no third-party image API, no
 * vendor lock-in.
 */
import { err, ok, type Result } from "@velloo/result";
import type { DesignFolder } from "../design-folder.ts";

const HAIKU_MODEL = "claude-haiku-4-5";

export interface GenerateImageOptions {
  /** Suggest "1:1" / "4:3" / "16:9" / "21:9". Default "16:9". */
  aspect?: "1:1" | "4:3" | "3:4" | "16:9" | "21:9";
  /** Pixel width hint; the URL targets this width. */
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
  /** Always "claude+picsum" — kept for response-shape stability. */
  source: "claude+picsum";
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

export async function generateImage(
  _folder: DesignFolder,
  prompt: string,
  opts: GenerateImageOptions = {},
): Promise<Result<GenerateImageResult, GenerateImageError>> {
  const trimmed = prompt.trim();
  if (!trimmed) return err({ kind: "EmptyPrompt" });

  const aspect = opts.aspect ?? "16:9";
  const [w, h] = ASPECT_DIMS[aspect];
  const targetW = opts.width ?? w;
  const targetH = Math.round((h * targetW) / w);

  const seed = hashSeed(trimmed);
  const src = `https://picsum.photos/seed/${seed}/${targetW}/${targetH}`;
  const alt = await suggestAltText(trimmed);
  return ok({
    src,
    aspect: ASPECT_CANVAS[aspect],
    alt,
    source: "claude+picsum",
  });
}
