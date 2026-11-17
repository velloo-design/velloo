import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReferencePatch } from "@velloo/protocol";
import {
  captureDir,
  captureUrlScreenshot,
  isSafeCaptureId,
  listCaptures,
  pngSize,
  readCaptureManifest,
  resizePng,
} from "@velloo/renderer";
import { err, ok, type Result } from "@velloo/result";
import type { SketchbookReference } from "@velloo/schema";
import { PNG } from "pngjs";
import { storeAssetAt } from "../fs.ts";
import { browserErrorMessage, captureTimeoutMessage } from "../mcp/tools/screenshot-helpers.ts";
import { badRequest, type MutationError } from "../mutations/errors.ts";
import type { MutationContext } from "../mutations/index.ts";

/**
 * A sketchbook's references: screenshots the person likes, kept as images
 * under `assets/sketchbook/<id>/refs/` so they reach image models the way
 * the sketchbook's own images do. Each comes from an upload, an image already
 * in the design folder, a stored browser capture, or a page the daemon
 * screenshots from a URL the person typed: a public page they point at, not
 * the app the design belongs to, so nothing here connects a design to it.
 */

/** The asset store's limit for one file. */
const MAX_BYTES = 5 * 1024 * 1024;
/** Image models take references inline at up to 4 MB each. */
const MAX_SENT_BYTES = 4 * 1024 * 1024;
/** The viewport a URL is screenshotted at: a laptop's. */
const VIEWPORT = { w: 1440, h: 900 };
/**
 * A screenshot is cut to the top of the page, at most twice as tall as wide,
 * then scaled to this width: a model reads the look off the first screens, and
 * a page ten screens long is a sliver it can't see.
 */
const WIDTH = 1024;
const MAX_ASPECT = 2;

/** The page capture, swapped for a stub in tests: the real one needs a browser. */
export const referenceCapture = { shoot: captureUrlScreenshot };

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** The image format the bytes are, read off their first bytes; null when none of ours. */
function sniff(bytes: Buffer): string | null {
  if (bytes.length < 12) return null;
  if (bytes.readUInt32BE(0) === 0x89504e47) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP")
    return "webp";
  if (bytes.toString("latin1", 0, 4) === "GIF8") return "gif";
  return null;
}

/** A page screenshot cut and scaled to what a model can read the look off. */
function fitScreenshot(png: Buffer): Buffer {
  const { width, height } = pngSize(png);
  let out = png;
  const tallest = Math.round(width * MAX_ASPECT);
  if (height > tallest) {
    const src = PNG.sync.read(png);
    const cut = new PNG({ width, height: tallest });
    PNG.bitblt(src, cut, 0, 0, width, tallest, 0, 0);
    out = PNG.sync.write(cut);
  }
  const size = pngSize(out);
  for (const w of [WIDTH, 768, 512]) {
    if (size.width > w) out = resizePng(out, w, Math.round((size.height * w) / size.width));
    if (out.length <= MAX_SENT_BYTES) break;
  }
  return out;
}

/** A slug a reference is known by, from where it came from, clear of the ids taken. */
export function referenceId(source: string, taken: readonly string[]): string {
  const base =
    source
      .toLowerCase()
      .replace(/^https?:\/\/(www\.)?/, "")
      .replace(/\.(png|jpe?g|webp|gif)$/, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "ref";
  const id = /^[a-z0-9]/.test(base) ? base : `ref-${base}`;
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? id : `${id}-${n}`;
    if (!taken.includes(candidate)) return candidate;
  }
}

const fail = (message: string): Result<never, MutationError> => err(badRequest(message));

/** A stored capture's page image on disk, and the page it is of. */
function captureImage(
  ctx: MutationContext,
  captureId: string,
): Result<{ file: string; url: string }, MutationError> {
  const folderId = ctx.folder.config.folderId;
  const manifest = isSafeCaptureId(captureId)
    ? readCaptureManifest(ctx.folder.root, captureId, folderId)
    : null;
  if (!manifest) return fail(`There's no capture "${captureId}"; list_captures lists them.`);
  if (manifest.themeOnly || !manifest.files.includes("page.png")) {
    return fail(`Capture "${captureId}" is theme-only: it has no page image to refer to.`);
  }
  return ok({
    file: join(captureDir(ctx.folder.root, captureId, folderId), "page.png"),
    url: manifest.url,
  });
}

/** The newest stored capture of `url` with a page image, if any. */
function captureOf(ctx: MutationContext, url: string): string | undefined {
  const same = (a: string) => a.replace(/#.*$/, "").replace(/\/$/, "");
  return listCaptures(ctx.folder.root, ctx.folder.config.folderId).find(
    (m) =>
      !m.themeOnly &&
      m.files.includes("page.png") &&
      m.stability?.status !== "unstable" &&
      (same(m.url) === same(url) || same(m.finalUrl) === same(url)),
  )?.id;
}

/** Why a live screenshot failed, said so the person can act on it. */
function shotFailure(url: string, e: unknown): string {
  const browser = browserErrorMessage(e);
  if (browser) {
    return `Velloo couldn't open a browser to screenshot ${url}. Run \`velloo browser install\`, then try again. (${browser.split("\n")[0]})`;
  }
  const slow = captureTimeoutMessage(e, "The screenshot");
  if (slow) return slow;
  const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
  return `Couldn't screenshot ${url}: ${msg}. Check the address opens in a browser, or upload a screenshot instead.`;
}

/**
 * Make a new reference's image and store it as `refs/<refId>.<ext>` in the
 * sketchbook's folder. Returns the reference to record; nothing is recorded
 * here, so the sweep would take the file if the record never lands.
 */
export async function makeReference(
  ctx: MutationContext,
  sketchbookId: string,
  refId: string,
  patch: ReferencePatch,
): Promise<Result<SketchbookReference, MutationError>> {
  const sources = [patch.data, patch.path, patch.url ?? patch.captureId].filter(
    (s) => s !== undefined,
  );
  if (sources.length !== 1) {
    return fail(
      "A new reference has one source: `url` (a page to screenshot), `captureId` (a stored capture), `path` (an image in the design folder) or `data` (an uploaded image).",
    );
  }
  let bytes: Buffer;
  let ext: string;
  let url: string | undefined;
  let captureId = patch.captureId;
  if (patch.data !== undefined) {
    const m = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(patch.data);
    const declared = m ? MIME_EXT[m[1] as string] : undefined;
    if (!m || !declared) {
      return fail("An uploaded reference is a PNG, JPEG, WebP or GIF image's data URL.");
    }
    bytes = Buffer.from(m[2] as string, "base64");
    const found = sniff(bytes);
    if (!found) return fail("That file isn't a PNG, JPEG, WebP or GIF image.");
    ext = found;
  } else if (patch.path !== undefined) {
    const path = patch.path.replace(/^\/+/, "");
    if (!path.startsWith("assets/") || path.includes("..")) {
      return fail(
        `"${patch.path}" isn't one of this design's assets: bring a file in with import_assets first, then pass its assets/ path.`,
      );
    }
    const read = await readFile(join(ctx.folder.root, path)).catch(() => null);
    if (!read) return fail(`"${patch.path}" isn't on disk.`);
    const found = sniff(read);
    if (!found) return fail(`"${patch.path}" isn't a PNG, JPEG, WebP or GIF image.`);
    bytes = read;
    ext = found;
  } else {
    if (patch.url !== undefined && !/^https?:$/.test(new URL(patch.url).protocol)) {
      return fail(`Only http(s) pages can be screenshotted, not ${patch.url}.`);
    }
    captureId ??= patch.url !== undefined ? captureOf(ctx, patch.url) : undefined;
    if (captureId !== undefined) {
      const found = captureImage(ctx, captureId);
      if (!found.ok) return found;
      const png = await readFile(found.value.file).catch(() => null);
      if (!png) return fail(`Capture "${captureId}" is missing its page image.`);
      bytes = fitScreenshot(png);
      url = patch.url ?? found.value.url;
    } else {
      const target = patch.url as string;
      try {
        const shot = await referenceCapture.shoot({
          url: target,
          viewport: VIEWPORT,
          fullPage: true,
        });
        if (shot.pageError) return fail(`${target} didn't load as a page: ${shot.pageError}.`);
        bytes = fitScreenshot(shot.png);
      } catch (e) {
        return fail(shotFailure(target, e));
      }
      url = target;
    }
    ext = "png";
  }
  if (bytes.length === 0 || bytes.length > MAX_BYTES) {
    return fail(
      `A reference image is at most ${MAX_BYTES / 1048576} MB; this one is ${(bytes.length / 1048576).toFixed(1)} MB.`,
    );
  }
  let stored: { assetPath: string };
  try {
    stored = await storeAssetAt(
      ctx.folder.root,
      `sketchbook/${sketchbookId}/refs/${refId}.${ext}`,
      bytes,
    );
  } catch (e) {
    return fail(`Couldn't store the reference: ${(e as Error).message}`);
  }
  return ok({
    id: refId,
    path: stored.assetPath,
    ...(url ? { url } : {}),
    ...(captureId ? { captureId } : {}),
    note: patch.note?.trim() ?? "",
    createdAt: new Date().toISOString(),
  });
}
