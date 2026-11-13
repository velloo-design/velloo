import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { LookSummary, UpdateLookBody } from "@velloo/protocol";
import { err, ok, type Result } from "@velloo/result";
import {
  designsScreens,
  imagesOf,
  type Look,
  type LookImage,
  LookSchema,
  latestOf,
  normalizeThemeName,
  type Theme,
  themeNameProblem,
} from "@velloo/schema";
import { emitActivity } from "../activity.ts";
import { themeByName } from "../design-folder.ts";
import { persistNamedTheme } from "../mutations/persist.ts";
import { readSketchbook } from "../sketchbook/sketchbook.ts";
import { type ThemeError, themeBadRequest } from "./errors.ts";
import { type ThemeContext, withThemeLock } from "./index.ts";
import { persistLook } from "./look-files.ts";
import { applyProposal, describeProposalError } from "./proposal.ts";

/**
 * Looks: a theme's tokens plus its sidecar (`looks/<name>.json`) of imagery,
 * rules and origin. Writes take the theme lock, because making a Look from a
 * sketchbook direction makes its theme too, and the two must land together.
 */

const EMPTY_LOOK: Look = LookSchema.parse({});

/** A theme's sidecar; null for a plain Look (tokens and no imagery). */
function lookOf(ctx: Pick<ThemeContext, "folder">, name: string): Look | null {
  return ctx.folder.looks.get(name) ?? null;
}

/** Every Look the design has, the default first, as the Looks rail lists them. */
export function listLooks(ctx: Pick<ThemeContext, "folder">): LookSummary[] {
  const names = [...ctx.folder.themes.keys()].sort((a, b) =>
    a === "default" ? -1 : b === "default" ? 1 : a.localeCompare(b),
  );
  return names.map((name) => {
    const theme = ctx.folder.themes.get(name) as Theme;
    return {
      name,
      look: lookOf(ctx, name),
      usedByBoards: [...ctx.folder.boards.values()]
        .filter((b) => (b.theme ?? "default") === name)
        .map((b) => b.id),
      swatch: [theme.colors.background, theme.colors.primary, theme.colors.accent]
        .map((c) => (typeof c === "object" ? c.DEFAULT : c))
        .filter((c): c is string => typeof c === "string"),
    };
  });
}

const fail = (message: string): Result<never, ThemeError> => err(themeBadRequest(message));

/** An image path a Look may record: an asset of this folder that is there. */
async function imageProblem(root: string, path: string): Promise<string | null> {
  if (!path.startsWith("assets/") || path.includes("..")) {
    return `"${path}" isn't one of this design's assets (a folder-relative path under assets/).`;
  }
  const found = await stat(join(root, path)).catch(() => null);
  return found?.isFile() ? null : `"${path}" isn't on disk.`;
}

type LookPatch = Omit<UpdateLookBody, "theme" | "fromSketchbook">;

/** Apply a patch to a Look: lists given replace, images merge by path. */
function patched(current: Look, patch: LookPatch): Look {
  const removed = new Set(patch.removeImages ?? []);
  const images = current.images.filter((i) => !removed.has(i.path));
  for (const image of patch.images ?? []) {
    const at = images.findIndex((i) => i.path === image.path);
    if (at < 0) images.push(image);
    else images[at] = { ...images[at], ...image };
  }
  return {
    ...current,
    images,
    ...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
    ...(patch.imagery !== undefined ? { imagery: patch.imagery.trim() } : {}),
    rules: {
      dos: patch.rules?.dos ?? current.rules.dos,
      donts: patch.rules?.donts ?? current.rules.donts,
    },
  };
}

async function writeLook(
  ctx: ThemeContext,
  name: string,
  current: Look,
  patch: LookPatch,
): Promise<Result<Look, ThemeError>> {
  for (const image of patch.images ?? []) {
    const problem = await imageProblem(ctx.folder.root, image.path);
    if (problem) return fail(problem);
  }
  const look = await persistLook(ctx.folder, name, {
    ...patched(current, patch),
    createdAt: current.createdAt ?? new Date().toISOString(),
  });
  ctx.broadcast({ type: "theme-changed" });
  emitActivity(ctx, "update_look", name === "default" ? {} : { themeName: name });
  return ok(look);
}

/** Change a Look's imagery, rules or description. Its tokens are `set_theme`'s. */
export function updateLook(
  ctx: ThemeContext,
  name: string,
  patch: LookPatch,
): Promise<Result<Look, ThemeError>> {
  return withThemeLock(ctx.folder, async () => {
    if (!ctx.folder.themes.has(name)) {
      return fail(
        `There's no Look "${name}". Known: ${[...ctx.folder.themes.keys()].join(", ")}. Make one with add_theme, or from a sketchbook direction (fromSketchbook).`,
      );
    }
    return writeLook(ctx, name, lookOf(ctx, name) ?? EMPTY_LOOK, patch);
  });
}

/** A theme name made from a direction's title, kept clear of the names already taken. */
function nameFor(title: string, taken: string[]): string {
  const base =
    normalizeThemeName(title.replace(/[^A-Za-z0-9 _-]+/g, " "))
      .slice(0, 40)
      .replace(/^[ _-]+|[ _-]+$/g, "") || "Look";
  for (let n = 1; ; n++) {
    const name = n === 1 ? base : `${base} ${n}`;
    if (themeNameProblem(name, taken) === null) return name;
  }
}

/** The direction's description cut to its first sentence: a Look's one line until someone writes it. */
function firstSentence(text: string): string {
  const sentence = text.trim().split(/(?<=[.!?])\s/)[0] ?? "";
  return sentence.length > 160 ? `${sentence.slice(0, 159)}…` : sentence;
}

/**
 * Make a Look from a sketchbook direction: a theme, a copy of `from`, and its
 * sidecar holding the direction's current mood board, its mocks and the latest
 * image of each other kind, with the direction as its origin. Named after the direction unless `name` is given;
 * a name that is already a Look's puts the images on that Look instead. A new
 * Look takes the direction's proposed tokens when it has them; otherwise the
 * tokens stay the copy's until someone sets them from the images.
 */
export async function lookFromSketchbook(
  ctx: ThemeContext,
  source: { sketchbook: string; direction: string; from?: string | undefined },
  name?: string,
  patch: LookPatch = {},
): Promise<Result<{ name: string; look: Look; created: boolean }, ThemeError>> {
  const read = await readSketchbook(ctx.folder.root, source.sketchbook);
  if (!read) return fail(`There's no sketchbook "${source.sketchbook}".`);
  if (read.problem) return fail(read.problem);
  const direction = read.sketchbook.directions.find((d) => d.id === source.direction);
  if (!direction) {
    return fail(
      `The sketchbook has no direction "${source.direction}"; its directions are ${read.sketchbook.directions.map((d) => d.id).join(", ") || "none yet"}.`,
    );
  }
  const origin = { sketchbook: source.sketchbook, direction: direction.id };
  // The current mood board, every page image, and the latest of each other kind.
  const kinds = [...new Set(direction.images.map((i) => i.kind))];
  const drawn: LookImage[] = kinds
    .flatMap((kind) =>
      kind !== "moodboard" && designsScreens(kind)
        ? imagesOf(direction, kind)
        : [latestOf(direction, kind)].filter((i) => i !== undefined),
    )
    .sort((a, b) => (a.kind === "moodboard" ? -1 : b.kind === "moodboard" ? 1 : 0))
    .map((i) => ({ path: i.path, kind: i.kind, source: origin }));
  // An image deleted by hand is left out rather than failing the Look.
  const images: LookImage[] = [];
  for (const image of drawn) {
    if ((await imageProblem(ctx.folder.root, image.path)) === null) images.push(image);
  }
  for (const image of patch.images ?? []) {
    const problem = await imageProblem(ctx.folder.root, image.path);
    if (problem) return fail(problem);
  }
  if (images.length === 0) {
    return fail(
      `"${direction.title}" has no images yet: draw its mood board first (generate_sketchbook { kind: "moodboard" }).`,
    );
  }
  if (source.from !== undefined && !ctx.folder.themes.has(source.from)) {
    return fail(`There's no Look "${source.from}" to copy.`);
  }
  return withThemeLock(ctx.folder, async () => {
    const known = [...ctx.folder.themes.keys()];
    const wanted = name === undefined ? undefined : normalizeThemeName(name);
    const existing = wanted === undefined ? undefined : known.find((k) => k === wanted);
    let target = existing;
    if (target === undefined) {
      if (wanted !== undefined) {
        const problem = themeNameProblem(wanted, known);
        if (problem) return fail(`The Look can't be called "${wanted}": ${problem}`);
      }
      target = wanted ?? nameFor(direction.title, known);
      const copy = JSON.parse(JSON.stringify(themeByName(ctx.folder, source.from))) as Theme;
      // A Look sketchbook's direction comes with its tokens already proposed.
      let tokens = copy;
      if (direction.proposal) {
        const applied = applyProposal(copy, direction.proposal);
        if (!applied.ok) {
          return fail(
            `"${direction.title}"'s proposed tokens don't apply: ${describeProposalError(applied.error)}.`,
          );
        }
        tokens = applied.value;
      }
      await persistNamedTheme(ctx.folder, target, tokens);
      emitActivity(ctx, "add_theme", { themeName: target });
    }
    const current = lookOf(ctx, target) ?? EMPTY_LOOK;
    const written = await writeLook(
      ctx,
      target,
      {
        ...current,
        origin,
        description: current.description || firstSentence(direction.description),
      },
      { ...patch, images: [...images, ...(patch.images ?? [])] },
    );
    if (!written.ok) return written;
    return ok({ name: target, look: written.value, created: existing === undefined });
  });
}
