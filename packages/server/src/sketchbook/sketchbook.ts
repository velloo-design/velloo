import { mkdir, readdir, readFile, rename, rm, rmdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type BuildSketchbookBody,
  formatCredits,
  type GenerateSketchbookBody,
  type SketchbookGenerateResult,
  type SketchbookPending,
  type SketchbookState,
  type SketchbookSummary,
  type UpdateSketchbookBody,
} from "@velloo/protocol";
import { err, ok, type Result } from "@velloo/result";
import {
  activeDirections,
  designsScreens,
  EMPTY_SKETCHBOOK,
  findSketchbookImage,
  latestOf,
  PAGE_IMAGE_KINDS,
  SKETCHBOOK_STAGES,
  type SketchbookDirection,
  type SketchbookFile,
  SketchbookFileSchema,
  type SketchbookImage,
  type SketchbookStage,
  sketchbookName,
  type Theme,
} from "@velloo/schema";
import { emitActivity } from "../activity.ts";
import type { CloudAuth } from "../cloud.ts";
import {
  describeGenerateFailure,
  fetchSketchbookKinds,
  generateSketchbookImage,
} from "../cloud-generate.ts";
import { readLooks, themeByName } from "../design-folder.ts";
import { writeJsonAtomic } from "../fs.ts";
import { hostHasApp } from "../host-app.ts";
import { addBoard } from "../mutations/api/boards.ts";
import { badRequest, type MutationError } from "../mutations/errors.ts";
import type { MutationContext } from "../mutations/index.ts";
import { applyProposal, describeProposalError } from "../theme/proposal.ts";
import { kindPrompt, MAX_IMAGE_PROMPT, PROMPTED_KINDS, revisePrompt } from "./prompts.ts";

/**
 * A design's sketchbooks, one file each in `sketchbooks/<id>.json` (see
 * the schema for what a sketchbook is), so an earlier one can be reopened
 * and taken further.
 *
 * Kept out of `DesignFolder`, like `assets.json`: nothing renders from them, a
 * generation that takes minutes must not hold a lock the screens share, and a
 * corrupt file should cost that sketchbook, not the canvas. Writes are
 * serialized per folder; generation reads, draws with no lock held, and records
 * each image as it lands.
 */

const DIR = "sketchbooks";
const IMAGE_DIR = "sketchbook";
/** The names before the rename: a folder of files, its images, and the single file before it. */
const OLD_DIR = "art-directions";
const OLD_IMAGE_DIR = "art-direction";
const OLD_SINGLE = "art-direction.json";
const ID = /^[a-z0-9][a-z0-9-]{0,60}$/;

const fileOf = (root: string, id: string) => join(root, DIR, `${id}.json`);

/** Sortable by when it was made, and safe as a file and folder name. */
const newSketchbookId = (): string =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

type Read = { sketchbook: SketchbookFile; problem?: string };

const chains = new Map<string, Promise<unknown>>();
function serialize<T>(root: string, op: () => Promise<T>): Promise<T> {
  const next = (chains.get(root) ?? Promise.resolve()).then(op, op);
  chains.set(
    root,
    next.catch(() => {}),
  );
  return next;
}

const OLD_PATH = new RegExp(`"(assets/${OLD_IMAGE_DIR}/[^"]+)"`, "g");

/**
 * Write a file from before the rename as `sketchbooks/<id>.json`, its images
 * moved under `assets/sketchbook/` by `place` and every recorded path
 * rewritten to match. A sketchbook already at that id wins.
 */
async function adopt(
  root: string,
  oldFile: string,
  id: string,
  place: (rel: string) => string,
): Promise<void> {
  const raw = await readFile(oldFile, "utf8");
  const target = fileOf(root, id);
  if (await stat(target).catch(() => null)) {
    await rm(oldFile, { force: true });
    return;
  }
  const from = `assets/${OLD_IMAGE_DIR}/`;
  const moved = (path: string) => `assets/${IMAGE_DIR}/${place(path.slice(from.length))}`;
  const paths = new Set([...raw.matchAll(OLD_PATH)].map((m) => m[1] as string));
  for (const path of paths) {
    if (path.includes("..")) continue;
    const to = moved(path);
    await mkdir(dirname(join(root, to)), { recursive: true });
    await rename(join(root, path), join(root, to)).catch(() => {});
  }
  const rewritten = raw.replace(OLD_PATH, (_, path: string) =>
    JSON.stringify(path.includes("..") ? path : moved(path)),
  );
  await writeJsonAtomic(target, JSON.parse(rewritten));
  await rm(oldFile, { force: true });
}

/**
 * Sketchbooks were art directions: `art-directions/<id>.json` with images in
 * `assets/art-direction/<id>/`, and before that the single
 * `art-direction.json`, whose images sat straight in `assets/art-direction/`.
 * The single file becomes the first of the list, and its images move into the
 * folder of its own every sketchbook has, so deleting it later takes them all.
 */
async function migrateLegacy(root: string): Promise<void> {
  const single = join(root, OLD_SINGLE);
  const at = await stat(single).catch(() => null);
  if (at) {
    const id = Math.round(at.mtimeMs).toString(36);
    await adopt(root, single, id, (rel) => (rel.startsWith(`${id}/`) ? rel : `${id}/${rel}`)).catch(
      () => {},
    );
  }
  const names = await readdir(join(root, OLD_DIR)).catch(() => [] as string[]);
  for (const name of names) {
    if (!name.endsWith(".json") || !ID.test(name.replace(/\.json$/, ""))) continue;
    await adopt(root, join(root, OLD_DIR, name), name.replace(/\.json$/, ""), (rel) => rel).catch(
      () => {},
    );
  }
  if (names.length > 0) await rmdir(join(root, OLD_DIR)).catch(() => {});
  await pruneEmpty(join(root, "assets", OLD_IMAGE_DIR));
}

/** Remove the empty folders under `dir`, and `dir` itself when it ends up empty. */
async function pruneEmpty(dir: string): Promise<boolean> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
  if (!entries) return false;
  let left = entries.length;
  for (const e of entries) {
    if (e.isDirectory() && (await pruneEmpty(join(dir, e.name)))) left--;
  }
  if (left > 0) return false;
  await rmdir(dir).catch(() => {});
  return true;
}

async function filesUnder(dir: string, rel: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const e of entries) {
    const path = `${rel}/${e.name}`;
    if (e.isDirectory()) out.push(...(await filesUnder(join(dir, e.name), path)));
    else out.push(path);
  }
  return out;
}

/**
 * The images the design's Looks show, which outlive the sketchbook they were
 * drawn in; null when a Look's file can't be read, so nothing is deleted
 * that it might show.
 */
async function lookImages(root: string): Promise<Set<string> | null> {
  const { looks, problems } = await readLooks(root);
  if (problems.length > 0) return null;
  const kept = new Set<string>();
  for (const look of looks.values()) {
    for (const image of look.images) kept.add(image.path);
    for (const reference of look.references) if (reference.path) kept.add(reference.path);
  }
  return kept;
}

/**
 * Delete every sketchbook image no sketchbook or Look records: a deleted
 * sketchbook's, a removed direction's, one whose record was lost. Nothing on
 * the canvas can reach them, so they would only take up room. Skipped while
 * an image is being drawn (it lands on disk before it is recorded) and while
 * any sketchbook's or Look's file can't be read, so a file being fixed by hand
 * keeps its images. Runs on the folder's write chain.
 */
async function sweep(root: string): Promise<void> {
  if (drawing(root)) return;
  const names = await readdir(join(root, DIR)).catch(() => [] as string[]);
  const kept = await lookImages(root);
  if (!kept) return;
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const read = await readFileOf(root, name.replace(/\.json$/, ""));
    if (!read || read.problem) return;
    for (const d of read.sketchbook.directions) {
      for (const image of d.images) kept.add(image.path);
    }
  }
  const base = join(root, "assets", IMAGE_DIR);
  for (const path of await filesUnder(base, `assets/${IMAGE_DIR}`)) {
    if (!kept.has(path)) await rm(join(root, path), { force: true });
  }
  await pruneEmpty(base);
}

/** Folders swept since the daemon started: once each, for what a hand-deleted file left. */
const swept = new Set<string>();

const migrated = (root: string) =>
  serialize(root, async () => {
    await migrateLegacy(root).catch(() => {});
    if (!swept.has(root)) {
      swept.add(root);
      await sweep(root).catch(() => {});
    }
  });

async function readFileOf(root: string, id: string): Promise<Read | null> {
  let raw: string;
  try {
    raw = await readFile(fileOf(root, id), "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = SketchbookFileSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return { sketchbook: parsed.data };
    return {
      sketchbook: EMPTY_SKETCHBOOK,
      problem: `${DIR}/${id}.json doesn't match the schema: ${parsed.error.issues[0]?.message ?? "invalid"}`,
    };
  } catch {
    return { sketchbook: EMPTY_SKETCHBOOK, problem: `${DIR}/${id}.json isn't valid JSON` };
  }
}

export async function readSketchbook(root: string, id: string): Promise<Read | null> {
  if (!ID.test(id)) return null;
  await migrated(root);
  return readFileOf(root, id);
}

function summary(id: string, sketchbook: SketchbookFile): SketchbookSummary {
  const images = sketchbook.directions.flatMap((d) => d.images);
  const newest = images.reduce<SketchbookImage | undefined>(
    (a, b) => (!a || b.createdAt > a.createdAt ? b : a),
    undefined,
  );
  return {
    id,
    name: sketchbookName(sketchbook),
    subject: sketchbook.subject,
    stage: sketchbook.stage,
    ...(sketchbook.updatedAt ? { updatedAt: sketchbook.updatedAt } : {}),
    agentSession: sketchbook.agentSession,
    buildBoard: sketchbook.buildBoard,
    ...(newest ? { cover: newest.path } : {}),
    directions: sketchbook.directions.length,
    images: images.length,
  };
}

/** Every sketchbook that reads, whole, for what is read across them (the links). */
export async function readSketchbooks(
  root: string,
): Promise<{ id: string; sketchbook: SketchbookFile }[]> {
  await migrated(root);
  const names = await readdir(join(root, DIR)).catch(() => [] as string[]);
  const out: { id: string; sketchbook: SketchbookFile }[] = [];
  for (const name of names) {
    const id = name.replace(/\.json$/, "");
    if (!name.endsWith(".json") || !ID.test(id)) continue;
    const read = await readFileOf(root, id);
    if (read && !read.problem) out.push({ id, sketchbook: read.sketchbook });
  }
  return out;
}

/** Every sketchbook, the most recently changed first. */
export async function listSketchbooks(root: string): Promise<SketchbookSummary[]> {
  await migrated(root);
  const names = await readdir(join(root, DIR)).catch(() => [] as string[]);
  const out: SketchbookSummary[] = [];
  for (const name of names) {
    const id = name.replace(/\.json$/, "");
    if (!name.endsWith(".json") || !ID.test(id)) continue;
    const read = await readFileOf(root, id);
    if (read && !read.problem) out.push(summary(id, read.sketchbook));
  }
  return out.sort((a, b) => (b.updatedAt ?? b.id).localeCompare(a.updatedAt ?? a.id));
}

const missing = (id: string) =>
  badRequest(
    `There's no sketchbook "${id}"; read get_sketchbook without an id for the latest, and its \`others\` for the rest.`,
  );

/** Read, change and write under the folder's chain; broadcast when it lands. */
async function change<T>(
  ctx: MutationContext,
  id: string,
  fn: (sketchbook: SketchbookFile) => Result<{ next: SketchbookFile; value: T }, MutationError>,
): Promise<Result<T, MutationError>> {
  const root = ctx.folder.root;
  await migrated(root);
  const result = await serialize(root, async () => {
    if (!ID.test(id)) return err(missing(id));
    const read = await readFileOf(root, id);
    if (!read) return err(missing(id));
    if (read.problem) return err(badRequest(`${read.problem}; fix or delete the file.`));
    const r = fn(read.sketchbook);
    if (!r.ok) return r;
    await writeJsonAtomic(
      fileOf(root, id),
      SketchbookFileSchema.parse({ ...r.value.next, updatedAt: new Date().toISOString() }),
    );
    return ok(r.value.value);
  });
  if (result.ok) ctx.broadcast({ type: "sketchbook-changed", id });
  return result;
}

// --- in-flight generations ----------------------------------------------------

const pendingByKey = new Map<string, SketchbookPending[]>();
const keyOf = (root: string, id: string) => `${root}\0${id}`;
const pendingFor = (root: string, id: string): SketchbookPending[] =>
  pendingByKey.get(keyOf(root, id)) ?? [];
/** Whether any image is being drawn in the folder: it is on disk before it is recorded. */
const drawing = (root: string): boolean =>
  [...pendingByKey].some(([key, p]) => key.startsWith(`${root}\0`) && p.length > 0);

function track(ctx: MutationContext, id: string, entry: SketchbookPending): () => void {
  const key = keyOf(ctx.folder.root, id);
  pendingByKey.set(key, [...(pendingByKey.get(key) ?? []), entry]);
  ctx.broadcast({ type: "sketchbook-changed", id });
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    pendingByKey.set(
      key,
      (pendingByKey.get(key) ?? []).filter((p) => p !== entry),
    );
    ctx.broadcast({ type: "sketchbook-changed", id });
  };
}

export async function sketchbookState(root: string, id: string): Promise<SketchbookState | null> {
  const read = await readSketchbook(root, id);
  if (!read) return null;
  return {
    id,
    sketchbook: read.sketchbook,
    pending: pendingFor(root, id),
    promptChars: promptChars(read.sketchbook),
  };
}

/** The longest prompt each kind of image would be sent with now. */
function promptChars(sketchbook: SketchbookFile): Record<string, number> {
  const brief = sketchbook.brief;
  const active = activeDirections(sketchbook);
  const longest = (kind: string) =>
    brief && drawsFor(sketchbook, kind)
      ? active
          .filter((d) => kind === "moodboard" || kind !== "mock" || d.picked)
          .map(
            (d) =>
              kindPrompt(kind, brief, d, {
                fromBoard: boardFor(sketchbook, d, kind) !== undefined,
                subject: sketchbook.subject,
              })?.length ?? 0,
          )
          .reduce((a, b) => Math.max(a, b), 0)
      : 0;
  return Object.fromEntries(PROMPTED_KINDS.map((k) => [k, longest(k)]));
}

/** A Look sketchbook draws no page: its images are the system's, not a layout's. */
const drawsFor = (sketchbook: Pick<SketchbookFile, "subject">, kind: string): boolean =>
  sketchbook.subject === "page" || !PAGE_IMAGE_KINDS.includes(kind);

/**
 * The mood board an image of `kind` is drawn from: the direction's current
 * one. Mocks go without it when the person skipped the mood boards.
 */
function boardFor(sketchbook: SketchbookFile, d: SketchbookDirection, kind: string) {
  if (kind === "moodboard" || (kind === "mock" && sketchbook.skipBoards)) return undefined;
  return latestOf(d, "moodboard");
}

// --- edits -------------------------------------------------------------------

const stageIndex = (s: SketchbookStage) => SKETCHBOOK_STAGES.indexOf(s);
/** Move the stage forward to `to`, never back (going back is the person's call). */
const atLeast = (current: SketchbookStage, to: SketchbookStage): SketchbookStage =>
  stageIndex(current) >= stageIndex(to) ? current : to;

/** A chosen image: one of the direction's images that a screen can be designed from. */
function findImage(directions: SketchbookDirection[], direction: string, path: string) {
  const image = directions.find((x) => x.id === direction)?.images.find((i) => i.path === path);
  return image && designsScreens(image.kind) ? image : undefined;
}

/** Begin a new sketchbook, beside any the design already has. */
export async function createSketchbook(
  ctx: MutationContext,
  body: Pick<UpdateSketchbookBody, "origin" | "page" | "name" | "agentSession" | "subject"> = {},
): Promise<Result<SketchbookState, MutationError>> {
  const root = ctx.folder.root;
  await migrated(root);
  const id = newSketchbookId();
  const now = new Date().toISOString();
  const sketchbook = SketchbookFileSchema.parse({
    version: 1,
    stage: "brief",
    name: body.name ?? "",
    subject: body.subject ?? "page",
    // A Look is explored for the app when there is one: no page needs picking.
    origin:
      body.origin ?? (body.subject === "look" ? (hostHasApp(ctx) ? "existing" : "new") : null),
    page: body.page ?? null,
    agentSession: body.agentSession ?? null,
    createdAt: now,
    updatedAt: now,
  });
  await serialize(root, () => writeJsonAtomic(fileOf(root, id), sketchbook));
  ctx.broadcast({ type: "sketchbook-changed", id });
  emitActivity(ctx, "update_sketchbook", {});
  return ok({ id, sketchbook, pending: [], promptChars: promptChars(sketchbook) });
}

export async function updateSketchbook(
  ctx: MutationContext,
  id: string,
  body: UpdateSketchbookBody,
): Promise<Result<SketchbookFile, MutationError>> {
  const r = await editSketchbook(ctx, id, body);
  // A removed direction's images go with it.
  if (r.ok && body.removeDirections?.length) {
    const root = ctx.folder.root;
    await serialize(root, () => sweep(root));
  }
  return r;
}

function editSketchbook(
  ctx: MutationContext,
  id: string,
  body: UpdateSketchbookBody,
): Promise<Result<SketchbookFile, MutationError>> {
  return change(ctx, id, (current) => {
    let directions = [...current.directions];
    for (const patch of body.directions ?? []) {
      const i = directions.findIndex((d) => d.id === patch.id);
      if (i < 0) {
        if (!patch.title || !patch.description) {
          return err(
            badRequest(
              `Direction "${patch.id}" is new, so it needs a title and a description (the look in words: palette with hex values, type, texture, imagery, motifs).`,
            ),
          );
        }
        directions.push({
          id: patch.id,
          title: patch.title,
          description: patch.description,
          layout: patch.layout ?? "",
          dropped: patch.dropped ?? false,
          picked: patch.picked ?? true,
          images: [],
          proposal: patch.proposal ?? null,
        });
      } else {
        const d = directions[i] as SketchbookDirection;
        directions[i] = {
          ...d,
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.layout !== undefined ? { layout: patch.layout } : {}),
          ...(patch.dropped !== undefined ? { dropped: patch.dropped } : {}),
          ...(patch.picked !== undefined ? { picked: patch.picked } : {}),
          ...(patch.proposal !== undefined ? { proposal: patch.proposal } : {}),
        };
      }
      if (patch.proposal) {
        const applied = applyProposal(themeByName(ctx.folder), patch.proposal);
        if (!applied.ok) {
          return err(
            badRequest(
              `Direction "${patch.id}"'s proposal doesn't apply to the theme: ${describeProposalError(applied.error)}. It takes set_theme's forms: tokens as dotted paths ("colors.primary.DEFAULT"), fonts as { role, family, google }.`,
            ),
          );
        }
      }
    }
    const subject = body.subject ?? current.subject;
    if (body.brief && subject === "page" && !body.brief.page.trim()) {
      return err(
        badRequest(
          'The brief names the page being designed (`page`: "the landing page"); a sketchbook exploring a Look alone is `subject: "look"`.',
        ),
      );
    }
    if (body.removeDirections?.length) {
      const gone = new Set(body.removeDirections);
      directions = directions.filter((d) => !gone.has(d.id));
    }
    const wrong = (body.chosen ?? []).find((c) => !findImage(directions, c.direction, c.image));
    if (wrong) {
      return err(
        badRequest(
          `There is no mock, mood board or other page image "${wrong.image}" in direction "${wrong.direction}" (palettes, type posters, UI kits, imagery and icons go with the screens, not one each); read the sketchbook for the images it has.`,
        ),
      );
    }
    // A choice whose direction was removed goes with it.
    const chosen = (body.chosen ?? current.chosen).filter((c) =>
      findImage(directions, c.direction, c.image),
    );
    const outputs = current.outputs.filter((o) => directions.some((d) => d.id === o.direction));
    const at = new Date().toISOString();
    for (const o of body.outputs ?? []) {
      const direction = findSketchbookImage({ directions }, o.image)?.direction;
      if (!direction) {
        return err(
          badRequest(
            `There is no image "${o.image}" in the sketchbook; an output names the image its screen was built from.`,
          ),
        );
      }
      if (!ctx.folder.screens.has(o.screen)) {
        return err(
          badRequest(`There is no screen "${o.screen}"; record a screen once it is composed.`),
        );
      }
      const record = { screen: o.screen, direction: direction.id, image: o.image, at };
      const i = outputs.findIndex((x) => x.screen === o.screen);
      if (i < 0) outputs.push(record);
      else outputs[i] = record;
    }
    let stage = body.stage ?? current.stage;
    // Writing the brief or the first directions moves the sketchbook on, so the
    // canvas follows the agent without a separate stage call.
    if (body.stage === undefined) {
      if (body.brief) stage = atLeast(stage, "brief");
      if (directions.length > 0 && current.directions.length === 0) {
        stage = atLeast(stage, "directions");
      }
      if (subject === "look" && body.directions?.some((p) => p.proposal)) {
        stage = atLeast(stage, "tokens");
      }
    }
    const next: SketchbookFile = {
      ...current,
      stage,
      name: body.name ?? current.name,
      subject,
      origin: body.origin === undefined ? (body.brief?.origin ?? current.origin) : body.origin,
      page: body.page === undefined ? current.page : body.page,
      agentSession: body.agentSession === undefined ? current.agentSession : body.agentSession,
      brief: body.brief ?? current.brief,
      directions,
      skipBoards: body.skipBoards ?? current.skipBoards,
      mockCount: body.mockCount ?? current.mockCount,
      models: { ...current.models, ...body.models },
      chosen,
      outputs,
      generateImages:
        body.generateImages === undefined ? current.generateImages : body.generateImages,
    };
    emitActivity(ctx, "update_sketchbook", {});
    return ok({ next, value: next });
  });
}

/**
 * The theme a Look sketchbook's direction proposes: its proposal over `base`
 * (default the design's theme), in memory. Err says why there is none.
 */
export async function proposalTheme(
  ctx: MutationContext,
  id: string,
  direction: string,
  base?: string,
): Promise<Result<Theme, string>> {
  const read = await readSketchbook(ctx.folder.root, id);
  if (!read || read.problem) return err(`There's no sketchbook "${id}".`);
  const proposal = read.sketchbook.directions.find((d) => d.id === direction)?.proposal;
  if (!proposal) return err(`Direction "${direction}" has no proposed tokens yet.`);
  const applied = applyProposal(themeByName(ctx.folder, base), proposal);
  return applied.ok ? ok(applied.value) : err(describeProposalError(applied.error));
}

/** Board names are short; the sketchbook's name is cut to fit. */
const boardName = (sketchbook: SketchbookFile) => {
  const name = sketchbookName(sketchbook);
  return `Sketchbook · ${name.length > 40 ? `${name.slice(0, 39)}…` : name}`;
};

/**
 * Hand the chosen images to the agent to design screens from: record them and
 * what the person said, and make the board the screens go on (again, if
 * theirs was deleted), so the canvas can show it while the agent works.
 */
export async function buildSketchbook(
  ctx: MutationContext,
  id: string,
  body: BuildSketchbookBody,
): Promise<Result<{ boardId: string }, MutationError>> {
  const read = await readSketchbook(ctx.folder.root, id);
  if (!read) return err(missing(id));
  let boardId = read.sketchbook.buildBoard;
  if (!boardId || !ctx.folder.boards.has(boardId)) {
    const made = await addBoard(ctx, { name: boardName(read.sketchbook) });
    if (!made.ok) return made;
    boardId = made.value.boardId;
  }
  const board = boardId;
  const updated = await updateSketchbook(ctx, id, {
    chosen: body.chosen,
    generateImages: body.generateImages,
    stage: "screens",
  });
  if (!updated.ok) return updated;
  const recorded = await change(ctx, id, (current) =>
    ok({
      next: {
        ...current,
        buildBoard: board,
        buildNotes: body.instructions.trim(),
        buildWithBoards: body.withBoards,
      },
      value: undefined,
    }),
  );
  if (!recorded.ok) return recorded;
  return ok({ boardId: board });
}

/**
 * A screen that lands on a sketchbook's build board while the agent works
 * through its chosen images is linked to the one chosen image no screen was
 * built from yet — the agent is told to record each output, and this catches
 * the one it forgot. When more than one image or screen is unaccounted for,
 * which went with which is the agent's to say, so nothing is guessed.
 */
export async function linkBuiltScreens(ctx: MutationContext, boardId: string): Promise<void> {
  const board = ctx.folder.boards.get(boardId);
  if (!board) return;
  for (const { id, sketchbook } of await readSketchbooks(ctx.folder.root)) {
    if (sketchbook.buildBoard !== boardId || sketchbook.stage !== "screens") continue;
    const built = new Set(sketchbook.outputs.map((o) => o.screen));
    const usedImages = new Set(sketchbook.outputs.map((o) => o.image));
    const images = sketchbook.chosen.filter((c) => !usedImages.has(c.image));
    const screens = [
      ...new Set(board.frames.map((f) => f.screen).filter((s) => ctx.folder.screens.has(s))),
    ].filter((s) => !built.has(s));
    const [image] = images;
    const [screen] = screens;
    if (images.length !== 1 || screens.length !== 1 || !image || !screen) continue;
    await editSketchbook(ctx, id, { outputs: [{ screen, image: image.image }] });
  }
}

/**
 * Delete a sketchbook and every image drawn for it. The person confirms
 * this on the canvas; the screens it built stay.
 */
export async function deleteSketchbook(
  ctx: MutationContext,
  id: string,
): Promise<Result<{ deleted: true }, MutationError>> {
  const root = ctx.folder.root;
  const read = await readSketchbook(root, id);
  if (!read) return err(missing(id));
  await serialize(root, async () => {
    // A Look keeps what it shows; without knowing what that is, every image stays.
    const kept = await lookImages(root);
    if (kept) {
      // One that began before every sketchbook had a folder of its own keeps
      // its images beside the others', so each is deleted by name too.
      const own = [
        ...read.sketchbook.directions.flatMap((d) => d.images.map((i) => i.path)),
        ...(await filesUnder(join(root, "assets", IMAGE_DIR, id), `assets/${IMAGE_DIR}/${id}`)),
      ];
      for (const path of own) {
        if (path.startsWith(`assets/${IMAGE_DIR}/`) && !path.includes("..") && !kept.has(path)) {
          await rm(join(root, path), { force: true });
        }
      }
    }
    await rm(fileOf(root, id), { force: true });
    await sweep(root);
  });
  ctx.broadcast({ type: "sketchbook-changed", id });
  emitActivity(ctx, "delete_sketchbook", {});
  return ok({ deleted: true });
}

// --- generation --------------------------------------------------------------

/** Generations a person or agent runs at once. */
const PARALLEL = 3;

async function inParallel(jobs: (() => Promise<void>)[]): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(PARALLEL, jobs.length) }, async () => {
      for (let i = next++; i < jobs.length; i = next++) await (jobs[i] as () => Promise<void>)();
    }),
  );
}

/** The file stem each kind is stored under; a kind added since is stored by its own name. */
const STEMS: Record<string, string> = { moodboard: "board" };

/**
 * The next free name for a direction's image of `kind`, without its extension:
 * the cloud's reply decides that (JPEG, from a cloud that sends it).
 */
function nextName(id: string, d: SketchbookDirection, kind: string, taken: Set<string>): string {
  const stem = STEMS[kind] ?? kind.replace(/[^a-z0-9-]/g, "");
  const existing = new Set(d.images.map((i) => i.path.replace(/\.[a-z]+$/, "")));
  for (let n = 1; ; n++) {
    const rel = `${IMAGE_DIR}/${id}/${d.id}/${stem}-${n}`;
    if (!existing.has(`assets/${rel}`) && !taken.has(rel)) {
      taken.add(rel);
      return rel;
    }
  }
}

type Job = {
  direction: SketchbookDirection;
  prompt: string;
  reference?: string;
  /** For a revision: the image it revises, and what was asked. */
  revise?: { mock: string; instruction: string };
  storeAt: string;
};

const quoted = (list: readonly string[]) => list.map((k) => `"${k}"`).join(", ");

/**
 * Draw images of one kind and record each as it lands, so the canvas shows
 * them one by one. Each image is its own paid generation, so one failure (a
 * refusal, a timeout) loses only that image and is reported beside the ones
 * that landed.
 */
export async function generateSketchbook(
  ctx: MutationContext,
  cloud: CloudAuth | undefined,
  id: string,
  body: GenerateSketchbookBody,
): Promise<Result<SketchbookGenerateResult, MutationError>> {
  if (!cloud?.url) {
    return err(
      badRequest(
        "Image generation needs velloo-cloud: ask the user to run `velloo login`, then try again.",
      ),
    );
  }
  const read = await readSketchbook(ctx.folder.root, id);
  if (!read) return err(missing(id));
  if (read.problem) return err(badRequest(`${read.problem}; fix or delete the file.`));
  const sketchbook = read.sketchbook;
  const brief = sketchbook.brief;
  if (!brief) {
    return err(
      badRequest(
        "Write the brief first (update_sketchbook { brief }): the images are drawn from it.",
      ),
    );
  }
  const kind = body.kind;
  if (!drawsFor(sketchbook, kind)) {
    return err(
      badRequest(
        `This sketchbook explores a Look, so it draws no page: draw a mood board, palette, type poster, UI kit or imagery, not a ${kind}.`,
      ),
    );
  }
  const { kinds, listed } = await fetchSketchbookKinds(cloud, PROMPTED_KINDS);
  const offered = kinds.find((k) => k.intent === kind);
  if (!offered) {
    return err(
      badRequest(
        `velloo-cloud doesn't draw "${kind}" ${listed ? "" : "(it lists no kinds of its own, so only the mood board and the mock) "}for a sketchbook; the kinds are ${quoted(kinds.map((k) => k.intent))}.`,
      ),
    );
  }
  if (body.aspect !== undefined && !offered.aspects.includes(body.aspect)) {
    return err(
      badRequest(
        `A ${kind} is drawn at ${quoted(offered.aspects)}, not "${body.aspect}"; leave \`aspect\` out for ${offered.defaultAspect}.`,
      ),
    );
  }
  if (body.focus !== undefined && kind !== "detail") {
    return err(badRequest('`focus` says what a close-up shows: send it with kind: "detail".'));
  }
  const revise = body.revise;
  const revisedOf = revise ? findSketchbookImage(sketchbook, revise.mock) : undefined;
  if (revise && (!revisedOf || revisedOf.image.kind !== kind || !PAGE_IMAGE_KINDS.includes(kind))) {
    return err(
      badRequest(
        !revisedOf
          ? `There is no image "${revise.mock}"; read the sketchbook for the images it has.`
          : !PAGE_IMAGE_KINDS.includes(revisedOf.image.kind)
            ? `A revision redraws a page image (${quoted(PAGE_IMAGE_KINDS)}); "${revise.mock}" is a ${revisedOf.image.kind}: draw it again instead.`
            : `"${revise.mock}" is a ${revisedOf.image.kind}: send kind: "${revisedOf.image.kind}".`,
      ),
    );
  }
  const revised = revisedOf?.direction;
  const wanted = revised
    ? [revised]
    : body.directions
      ? sketchbook.directions.filter((d) => body.directions?.includes(d.id))
      : activeDirections(sketchbook).filter((d) => kind === "moodboard" || d.picked);
  const unknown = (body.directions ?? []).filter(
    (dir) => !sketchbook.directions.some((d) => d.id === dir),
  );
  if (unknown.length > 0) {
    return err(
      badRequest(`No direction ${unknown.map((u) => `"${u}"`).join(", ")} in the sketchbook.`),
    );
  }
  if (wanted.length === 0) {
    return err(
      badRequest(
        kind === "moodboard"
          ? "There are no directions in the running; add some first."
          : "No direction is picked; pick one (update_sketchbook { directions: [{ id, picked: true }] }).",
      ),
    );
  }
  if (kind === "mock" && !sketchbook.skipBoards && !revise) {
    const unboarded = wanted.filter((d) => !latestOf(d, "moodboard"));
    if (unboarded.length > 0) {
      return err(
        badRequest(
          `${unboarded.map((d) => `"${d.title}"`).join(", ")} ${unboarded.length === 1 ? "has" : "have"} no mood board yet, and mocks are drawn from it. Draw ${unboarded.length === 1 ? "it" : "them"} first (generate_sketchbook { kind: "moodboard" }), or skip mood boards (update_sketchbook { skipBoards: true }).`,
        ),
      );
    }
  }
  // A kind whose intent takes no references is drawn from the direction's words.
  const takesReference = offered.reference !== "forbidden" && offered.maxReferences !== 0;

  const taken = new Set<string>();
  const jobs: Job[] = [];
  const times = body.count ?? (kind === "mock" || revise ? sketchbook.mockCount : 1);
  for (const d of wanted) {
    if (revise) {
      for (let i = 0; i < times; i++) {
        jobs.push({
          direction: d,
          prompt: revisePrompt(brief, revise.instruction, kind),
          reference: revise.mock,
          revise,
          storeAt: nextName(id, d, kind, taken),
        });
      }
      continue;
    }
    const board = takesReference ? boardFor(sketchbook, d, kind) : undefined;
    const prompt = kindPrompt(kind, brief, d, {
      fromBoard: board !== undefined,
      focus: body.focus,
      subject: sketchbook.subject,
    }) as string;
    for (let i = 0; i < times; i++) {
      jobs.push({
        direction: d,
        prompt,
        ...(board ? { reference: board.path } : {}),
        storeAt: nextName(id, d, kind, taken),
      });
    }
  }
  const limit = Math.min(MAX_IMAGE_PROMPT, offered.maxPromptChars ?? MAX_IMAGE_PROMPT);
  const tooLong = jobs.find((j) => j.prompt.length > limit);
  if (tooLong) {
    return err(
      badRequest(
        `The prompt for "${tooLong.direction.title}" would be ${tooLong.prompt.length} characters, and image models take ${limit}. Shorten the brief's copy (${brief.content.length} characters now) or the direction's words.`,
      ),
    );
  }

  const model = body.model ?? sketchbook.models[kind];
  const left = new Map(
    wanted.map((d) => [d.id, jobs.filter((j) => j.direction.id === d.id).length]),
  );
  const finish = new Map(
    wanted.map((d) => [
      d.id,
      track(ctx, id, { direction: d.id, kind, count: left.get(d.id) ?? 0 }),
    ]),
  );
  const made: SketchbookGenerateResult["made"] = [];
  const failed: SketchbookGenerateResult["failed"] = [];
  let charged = 0;
  let balance: number | undefined;

  const draw = async (job: Job) => {
    const dir = job.direction.id;
    const r = await generateSketchbookImage(ctx.folder.root, cloud, {
      intent: kind,
      prompt: job.prompt,
      model,
      aspect: body.aspect,
      ...(job.reference ? { reference: [job.reference] } : {}),
      storeAt: job.storeAt,
    });
    if (r.ok) {
      charged += r.value.chargedMicros;
      balance =
        balance === undefined ? r.value.balanceMicros : Math.min(balance, r.value.balanceMicros);
      const image: SketchbookImage = {
        kind,
        path: r.value.assetPath,
        model: r.value.model,
        prompt: job.prompt,
        ...(job.revise
          ? { revisedFrom: job.revise.mock, instruction: job.revise.instruction.trim() }
          : job.reference
            ? { fromBoard: job.reference }
            : {}),
        ...(body.focus?.trim() ? { focus: body.focus.trim() } : {}),
        ...(r.value.width && r.value.height
          ? { width: r.value.width, height: r.value.height }
          : {}),
        createdAt: new Date().toISOString(),
      };
      // Recorded as it lands, so the canvas shows it without waiting for the rest.
      const recorded = await change(ctx, id, (current) => {
        const directions = current.directions.map((d) =>
          d.id !== dir ? d : { ...d, images: [...d.images, image] },
        );
        const stage =
          kind === "moodboard" || current.subject === "look"
            ? atLeast(current.stage, "boards")
            : kind === "mock"
              ? atLeast(current.stage, "mocks")
              : current.stage;
        return ok({ next: { ...current, directions, stage }, value: undefined });
      });
      // The image is paid for and on disk; a lost record is worth saying, not
      // worth failing the run over.
      if (recorded.ok) made.push({ direction: dir, kind, path: r.value.assetPath });
      else
        failed.push({
          direction: dir,
          message: "The image was made but the sketchbook couldn't record it.",
        });
    } else {
      failed.push({ direction: dir, message: describeGenerateFailure(r.error) });
    }
    const remaining = (left.get(dir) ?? 1) - 1;
    left.set(dir, remaining);
    if (remaining === 0) finish.get(dir)?.();
  };

  try {
    await inParallel(jobs.map((job) => () => draw(job)));
  } finally {
    for (const done of finish.values()) done();
  }
  if (made.length > 0) emitActivity(ctx, "generate_sketchbook", {});
  return ok({
    made,
    failed,
    ...(made.length > 0
      ? {
          cost: `cost ${formatCredits(charged)}${balance === undefined ? "" : `, balance ${formatCredits(balance)}`}`,
        }
      : {}),
  });
}

/** Delete one sketchbook image: its file and its record. */
export function removeSketchbookImage(
  ctx: MutationContext,
  id: string,
  path: string,
): Promise<Result<SketchbookFile, MutationError>> {
  return change(ctx, id, (current) => {
    let found = false;
    const directions = current.directions.map((d) => {
      const images = d.images.filter((i) => i.path !== path);
      if (images.length !== d.images.length) found = true;
      return { ...d, images };
    });
    if (!found) return err(badRequest(`"${path}" isn't a sketchbook image.`));
    const chosen = current.chosen.filter((c) => c.image !== path);
    if (path.startsWith(`assets/${IMAGE_DIR}/`) && !path.includes("..")) {
      const root = ctx.folder.root;
      // A Look that shows it keeps the file; only the sketchbook's record goes.
      void lookImages(root)
        .then((kept) => (kept && !kept.has(path) ? rm(join(root, path), { force: true }) : null))
        .then(() => (drawing(root) ? false : pruneEmpty(join(root, "assets", IMAGE_DIR))))
        .catch(() => {});
    }
    const next = { ...current, directions, chosen };
    return ok({ next, value: next });
  });
}
