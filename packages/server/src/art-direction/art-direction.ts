import { mkdir, readdir, readFile, rename, rm, rmdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type ArtDirectionGenerateResult,
  type ArtDirectionPending,
  type ArtDirectionState,
  type ArtDirectionSummary,
  type BuildArtDirectionBody,
  formatCredits,
  type GenerateArtDirectionBody,
  type UpdateArtDirectionBody,
} from "@velloo/protocol";
import { err, ok, type Result } from "@velloo/result";
import {
  ART_DIRECTION_STAGES,
  type ArtDirectionDirection,
  type ArtDirectionFile,
  ArtDirectionFileSchema,
  type ArtDirectionImage,
  type ArtDirectionStage,
  activeDirections,
  artDirectionName,
  currentBoard,
  EMPTY_ART_DIRECTION,
} from "@velloo/schema";
import { emitActivity } from "../activity.ts";
import type { CloudAuth } from "../cloud.ts";
import { describeGenerateFailure, generateArtDirectionImage } from "../cloud-generate.ts";
import { writeJsonAtomic } from "../fs.ts";
import { addBoard } from "../mutations/api/boards.ts";
import { badRequest, type MutationError } from "../mutations/errors.ts";
import type { MutationContext } from "../mutations/index.ts";
import { boardPrompt, MAX_IMAGE_PROMPT, mockPrompt, revisePrompt } from "./prompts.ts";

/**
 * A design's art directions, one file each in `art-directions/<id>.json` (see
 * the schema for what an art direction is), so an earlier one can be reopened
 * and taken further.
 *
 * Kept out of `DesignFolder`, like `assets.json`: nothing renders from them, a
 * generation that takes minutes must not hold a lock the screens share, and a
 * corrupt file should cost that art direction, not the canvas. Writes are
 * serialized per folder; generation reads, draws with no lock held, and records
 * each image as it lands.
 */

const DIR = "art-directions";
/** Where the one art direction a design could have lived, before there could be several. */
const LEGACY = "art-direction.json";
const IMAGE_DIR = "art-direction";
const ID = /^[a-z0-9][a-z0-9-]{0,60}$/;

const fileOf = (root: string, id: string) => join(root, DIR, `${id}.json`);

/** Sortable by when it was made, and safe as a file and folder name. */
const newArtDirectionId = (): string =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

type Read = { artDirection: ArtDirectionFile; problem?: string };

const chains = new Map<string, Promise<unknown>>();
function serialize<T>(root: string, op: () => Promise<T>): Promise<T> {
  const next = (chains.get(root) ?? Promise.resolve()).then(op, op);
  chains.set(
    root,
    next.catch(() => {}),
  );
  return next;
}

/**
 * The legacy single file becomes the first of the list, and its images move
 * into the folder of its own every art direction has, so deleting it later
 * takes them all.
 */
async function migrateLegacy(root: string): Promise<void> {
  const legacy = join(root, LEGACY);
  const at = await stat(legacy).catch(() => null);
  if (!at) return;
  const id = Math.round(at.mtimeMs).toString(36);
  const raw = await readFile(legacy, "utf8");
  const from = `assets/${IMAGE_DIR}/`;
  const moved = (path: string) =>
    path.startsWith(from) && !path.startsWith(`${from}${id}/`)
      ? `${from}${id}/${path.slice(from.length)}`
      : path;
  const paths = new Set(
    [...raw.matchAll(/"(assets\/art-direction\/[^"]+)"/g)].map((m) => m[1] as string),
  );
  for (const path of paths) {
    const to = moved(path);
    if (to === path || path.includes("..")) continue;
    await mkdir(dirname(join(root, to)), { recursive: true });
    await rename(join(root, path), join(root, to)).catch(() => {});
  }
  const rewritten = raw.replace(/"(assets\/art-direction\/[^"]+)"/g, (_, path: string) =>
    JSON.stringify(path.includes("..") ? path : moved(path)),
  );
  await writeJsonAtomic(fileOf(root, id), JSON.parse(rewritten));
  await rm(legacy, { force: true });
  await pruneEmpty(join(root, "assets", IMAGE_DIR));
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
 * Delete every art direction image no art direction records: a deleted art
 * direction's, a removed direction's, one whose record was lost. Nothing on
 * the canvas can reach them, so they would only take up room. Skipped while
 * an image is being drawn (it lands on disk before it is recorded) and while
 * any art direction's file can't be read, so a file being fixed by hand keeps
 * its images. Runs on the folder's write chain.
 */
async function sweep(root: string): Promise<void> {
  if (drawing(root)) return;
  const names = await readdir(join(root, DIR)).catch(() => [] as string[]);
  const kept = new Set<string>();
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const read = await readFileOf(root, name.replace(/\.json$/, ""));
    if (!read || read.problem) return;
    for (const d of read.artDirection.directions) {
      for (const image of [...d.boards, ...d.mocks]) kept.add(image.path);
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
    const parsed = ArtDirectionFileSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return { artDirection: parsed.data };
    return {
      artDirection: EMPTY_ART_DIRECTION,
      problem: `${DIR}/${id}.json doesn't match the schema: ${parsed.error.issues[0]?.message ?? "invalid"}`,
    };
  } catch {
    return { artDirection: EMPTY_ART_DIRECTION, problem: `${DIR}/${id}.json isn't valid JSON` };
  }
}

export async function readArtDirection(root: string, id: string): Promise<Read | null> {
  if (!ID.test(id)) return null;
  await migrated(root);
  return readFileOf(root, id);
}

function summary(id: string, artDirection: ArtDirectionFile): ArtDirectionSummary {
  const images = artDirection.directions.flatMap((d) => [...d.boards, ...d.mocks]);
  const newest = images.reduce<ArtDirectionImage | undefined>(
    (a, b) => (!a || b.createdAt > a.createdAt ? b : a),
    undefined,
  );
  return {
    id,
    name: artDirectionName(artDirection),
    stage: artDirection.stage,
    ...(artDirection.updatedAt ? { updatedAt: artDirection.updatedAt } : {}),
    agentSession: artDirection.agentSession,
    buildBoard: artDirection.buildBoard,
    ...(newest ? { cover: newest.path } : {}),
    directions: artDirection.directions.length,
    images: images.length,
  };
}

/** Every art direction, the most recently changed first. */
export async function listArtDirections(root: string): Promise<ArtDirectionSummary[]> {
  await migrated(root);
  const names = await readdir(join(root, DIR)).catch(() => [] as string[]);
  const out: ArtDirectionSummary[] = [];
  for (const name of names) {
    const id = name.replace(/\.json$/, "");
    if (!name.endsWith(".json") || !ID.test(id)) continue;
    const read = await readFileOf(root, id);
    if (read && !read.problem) out.push(summary(id, read.artDirection));
  }
  return out.sort((a, b) => (b.updatedAt ?? b.id).localeCompare(a.updatedAt ?? a.id));
}

const missing = (id: string) =>
  badRequest(
    `There's no art direction "${id}"; read get_art_direction without an id for the latest, and its \`others\` for the rest.`,
  );

/** Read, change and write under the folder's chain; broadcast when it lands. */
async function change<T>(
  ctx: MutationContext,
  id: string,
  fn: (
    artDirection: ArtDirectionFile,
  ) => Result<{ next: ArtDirectionFile; value: T }, MutationError>,
): Promise<Result<T, MutationError>> {
  const root = ctx.folder.root;
  await migrated(root);
  const result = await serialize(root, async () => {
    if (!ID.test(id)) return err(missing(id));
    const read = await readFileOf(root, id);
    if (!read) return err(missing(id));
    if (read.problem) return err(badRequest(`${read.problem}; fix or delete the file.`));
    const r = fn(read.artDirection);
    if (!r.ok) return r;
    await writeJsonAtomic(
      fileOf(root, id),
      ArtDirectionFileSchema.parse({ ...r.value.next, updatedAt: new Date().toISOString() }),
    );
    return ok(r.value.value);
  });
  if (result.ok) ctx.broadcast({ type: "art-direction-changed", id });
  return result;
}

// --- in-flight generations ----------------------------------------------------

const pendingByKey = new Map<string, ArtDirectionPending[]>();
const keyOf = (root: string, id: string) => `${root}\0${id}`;
const pendingFor = (root: string, id: string): ArtDirectionPending[] =>
  pendingByKey.get(keyOf(root, id)) ?? [];
/** Whether any image is being drawn in the folder: it is on disk before it is recorded. */
const drawing = (root: string): boolean =>
  [...pendingByKey].some(([key, p]) => key.startsWith(`${root}\0`) && p.length > 0);

function track(ctx: MutationContext, id: string, entry: ArtDirectionPending): () => void {
  const key = keyOf(ctx.folder.root, id);
  pendingByKey.set(key, [...(pendingByKey.get(key) ?? []), entry]);
  ctx.broadcast({ type: "art-direction-changed", id });
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    pendingByKey.set(
      key,
      (pendingByKey.get(key) ?? []).filter((p) => p !== entry),
    );
    ctx.broadcast({ type: "art-direction-changed", id });
  };
}

export async function artDirectionState(
  root: string,
  id: string,
): Promise<ArtDirectionState | null> {
  const read = await readArtDirection(root, id);
  if (!read) return null;
  return {
    id,
    artDirection: read.artDirection,
    pending: pendingFor(root, id),
    promptChars: promptChars(read.artDirection),
  };
}

/** The longest prompt each kind of image would be sent with now. */
function promptChars(artDirection: ArtDirectionFile): { moodboard: number; mock: number } {
  const brief = artDirection.brief;
  if (!brief) return { moodboard: 0, mock: 0 };
  const active = activeDirections(artDirection);
  const longest = (lengths: number[]) => lengths.reduce((a, b) => Math.max(a, b), 0);
  return {
    moodboard: longest(active.map((d) => boardPrompt(brief, d).length)),
    mock: longest(
      active
        .filter((d) => d.picked)
        .map(
          (d) =>
            mockPrompt(brief, d, {
              fromBoard: !artDirection.skipBoards && currentBoard(d) !== undefined,
            }).length,
        ),
    ),
  };
}

// --- edits -------------------------------------------------------------------

const stageIndex = (s: ArtDirectionStage) => ART_DIRECTION_STAGES.indexOf(s);
/** Move the stage forward to `to`, never back (going back is the person's call). */
const atLeast = (current: ArtDirectionStage, to: ArtDirectionStage): ArtDirectionStage =>
  stageIndex(current) >= stageIndex(to) ? current : to;

/** A chosen image: one of the direction's mocks or mood boards. */
function findImage(directions: ArtDirectionDirection[], direction: string, path: string) {
  const d = directions.find((x) => x.id === direction);
  return d?.mocks.find((m) => m.path === path) ?? d?.boards.find((b) => b.path === path);
}

/** Begin a new art direction, beside any the design already has. */
export async function createArtDirection(
  ctx: MutationContext,
  body: Pick<UpdateArtDirectionBody, "origin" | "page" | "name" | "agentSession"> = {},
): Promise<Result<ArtDirectionState, MutationError>> {
  const root = ctx.folder.root;
  await migrated(root);
  const id = newArtDirectionId();
  const now = new Date().toISOString();
  const artDirection = ArtDirectionFileSchema.parse({
    version: 1,
    stage: "brief",
    name: body.name ?? "",
    origin: body.origin ?? null,
    page: body.page ?? null,
    agentSession: body.agentSession ?? null,
    createdAt: now,
    updatedAt: now,
  });
  await serialize(root, () => writeJsonAtomic(fileOf(root, id), artDirection));
  ctx.broadcast({ type: "art-direction-changed", id });
  emitActivity(ctx, "update_art_direction", {});
  return ok({ id, artDirection, pending: [], promptChars: promptChars(artDirection) });
}

export async function updateArtDirection(
  ctx: MutationContext,
  id: string,
  body: UpdateArtDirectionBody,
): Promise<Result<ArtDirectionFile, MutationError>> {
  const r = await editArtDirection(ctx, id, body);
  // A removed direction's images go with it.
  if (r.ok && body.removeDirections?.length) {
    const root = ctx.folder.root;
    await serialize(root, () => sweep(root));
  }
  return r;
}

function editArtDirection(
  ctx: MutationContext,
  id: string,
  body: UpdateArtDirectionBody,
): Promise<Result<ArtDirectionFile, MutationError>> {
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
          boards: [],
          mocks: [],
        });
      } else {
        const d = directions[i] as ArtDirectionDirection;
        directions[i] = {
          ...d,
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.layout !== undefined ? { layout: patch.layout } : {}),
          ...(patch.dropped !== undefined ? { dropped: patch.dropped } : {}),
          ...(patch.picked !== undefined ? { picked: patch.picked } : {}),
        };
      }
    }
    if (body.removeDirections?.length) {
      const gone = new Set(body.removeDirections);
      directions = directions.filter((d) => !gone.has(d.id));
    }
    const wrong = (body.chosen ?? []).find((c) => !findImage(directions, c.direction, c.image));
    if (wrong) {
      return err(
        badRequest(
          `There is no mock or mood board "${wrong.image}" in direction "${wrong.direction}"; read the art direction for the images it has.`,
        ),
      );
    }
    // A choice whose direction was removed goes with it.
    const chosen = (body.chosen ?? current.chosen).filter((c) =>
      findImage(directions, c.direction, c.image),
    );
    let stage = body.stage ?? current.stage;
    // Writing the brief or the first directions moves the art direction on, so the
    // canvas follows the agent without a separate stage call.
    if (body.stage === undefined) {
      if (body.brief) stage = atLeast(stage, "brief");
      if (directions.length > 0 && current.directions.length === 0) {
        stage = atLeast(stage, "directions");
      }
    }
    const next: ArtDirectionFile = {
      ...current,
      stage,
      name: body.name ?? current.name,
      origin: body.origin === undefined ? (body.brief?.origin ?? current.origin) : body.origin,
      page: body.page === undefined ? current.page : body.page,
      agentSession: body.agentSession === undefined ? current.agentSession : body.agentSession,
      brief: body.brief ?? current.brief,
      directions,
      skipBoards: body.skipBoards ?? current.skipBoards,
      mockCount: body.mockCount ?? current.mockCount,
      models: { ...current.models, ...body.models },
      chosen,
      generateImages:
        body.generateImages === undefined ? current.generateImages : body.generateImages,
    };
    emitActivity(ctx, "update_art_direction", {});
    return ok({ next, value: next });
  });
}

/** Board names are short; the art direction's name is cut to fit. */
const boardName = (artDirection: ArtDirectionFile) => {
  const name = artDirectionName(artDirection);
  return `Art direction · ${name.length > 40 ? `${name.slice(0, 39)}…` : name}`;
};

/**
 * Hand the chosen images to the agent to design screens from: record them and
 * what the person said, and make the board the screens go on (again, if
 * theirs was deleted), so the canvas can show it while the agent works.
 */
export async function buildArtDirection(
  ctx: MutationContext,
  id: string,
  body: BuildArtDirectionBody,
): Promise<Result<{ boardId: string }, MutationError>> {
  const read = await readArtDirection(ctx.folder.root, id);
  if (!read) return err(missing(id));
  let boardId = read.artDirection.buildBoard;
  if (!boardId || !ctx.folder.boards.has(boardId)) {
    const made = await addBoard(ctx, { name: boardName(read.artDirection) });
    if (!made.ok) return made;
    boardId = made.value.boardId;
  }
  const board = boardId;
  const updated = await updateArtDirection(ctx, id, {
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
 * Delete an art direction and every image drawn for it. The person confirms
 * this on the canvas; the screens it built stay.
 */
export async function deleteArtDirection(
  ctx: MutationContext,
  id: string,
): Promise<Result<{ deleted: true }, MutationError>> {
  const root = ctx.folder.root;
  const read = await readArtDirection(root, id);
  if (!read) return err(missing(id));
  await serialize(root, async () => {
    // One that began before every art direction had a folder of its own keeps
    // its images beside the others', so each is deleted by name too.
    for (const d of read.artDirection.directions) {
      for (const image of [...d.boards, ...d.mocks]) {
        if (image.path.startsWith(`assets/${IMAGE_DIR}/`) && !image.path.includes("..")) {
          await rm(join(root, image.path), { force: true });
        }
      }
    }
    await rm(join(root, "assets", IMAGE_DIR, id), { recursive: true, force: true });
    await rm(fileOf(root, id), { force: true });
    await sweep(root);
  });
  ctx.broadcast({ type: "art-direction-changed", id });
  emitActivity(ctx, "delete_art_direction", {});
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

/**
 * The next free name for a direction's board or mock, without its extension:
 * the cloud's reply decides that (JPEG, from a cloud that sends it).
 */
function nextName(
  id: string,
  d: ArtDirectionDirection,
  kind: "moodboard" | "mock",
  taken: Set<string>,
): string {
  const stem = kind === "moodboard" ? "board" : "mock";
  const existing = new Set([...d.boards, ...d.mocks].map((i) => i.path.replace(/\.[a-z]+$/, "")));
  for (let n = 1; ; n++) {
    const rel = `${IMAGE_DIR}/${id}/${d.id}/${stem}-${n}`;
    if (!existing.has(`assets/${rel}`) && !taken.has(rel)) {
      taken.add(rel);
      return rel;
    }
  }
}

type Job = {
  direction: ArtDirectionDirection;
  prompt: string;
  reference?: string;
  /** For a revision: the mock it revises, and what was asked. */
  revise?: { mock: string; instruction: string };
  storeAt: string;
};

/**
 * Draw mood boards or mocks and record each as it lands, so the canvas shows
 * them one by one. Each image is its own paid generation, so one failure (a
 * refusal, a timeout) loses only that image and is reported beside the ones
 * that landed.
 */
export async function generateArtDirection(
  ctx: MutationContext,
  cloud: CloudAuth | undefined,
  id: string,
  body: GenerateArtDirectionBody,
): Promise<Result<ArtDirectionGenerateResult, MutationError>> {
  if (!cloud?.url) {
    return err(
      badRequest(
        "Image generation needs velloo-cloud: ask the user to run `velloo login`, then try again.",
      ),
    );
  }
  const read = await readArtDirection(ctx.folder.root, id);
  if (!read) return err(missing(id));
  if (read.problem) return err(badRequest(`${read.problem}; fix or delete the file.`));
  const artDirection = read.artDirection;
  const brief = artDirection.brief;
  if (!brief) {
    return err(
      badRequest(
        "Write the brief first (update_art_direction { brief }): the images are drawn from it.",
      ),
    );
  }
  const kind = body.kind;
  const revise = body.revise;
  const revised = revise
    ? artDirection.directions.find((d) => d.mocks.some((m) => m.path === revise.mock))
    : undefined;
  if (revise && (kind !== "mock" || !revised)) {
    return err(
      badRequest(
        kind !== "mock"
          ? 'A revision redraws a mock: send kind: "mock".'
          : `There is no mock "${revise.mock}"; read the art direction for the mocks it has.`,
      ),
    );
  }
  const wanted = revised
    ? [revised]
    : body.directions
      ? artDirection.directions.filter((d) => body.directions?.includes(d.id))
      : activeDirections(artDirection).filter((d) => kind === "moodboard" || d.picked);
  const unknown = (body.directions ?? []).filter(
    (dir) => !artDirection.directions.some((d) => d.id === dir),
  );
  if (unknown.length > 0) {
    return err(
      badRequest(`No direction ${unknown.map((u) => `"${u}"`).join(", ")} in the art direction.`),
    );
  }
  if (wanted.length === 0) {
    return err(
      badRequest(
        kind === "mock"
          ? "No direction is picked for mocks; pick one (update_art_direction { directions: [{ id, picked: true }] })."
          : "There are no directions in the running; add some first.",
      ),
    );
  }
  if (kind === "mock" && !artDirection.skipBoards && !revise) {
    const unboarded = wanted.filter((d) => !currentBoard(d));
    if (unboarded.length > 0) {
      return err(
        badRequest(
          `${unboarded.map((d) => `"${d.title}"`).join(", ")} ${unboarded.length === 1 ? "has" : "have"} no mood board yet, and mocks are drawn from it. Draw ${unboarded.length === 1 ? "it" : "them"} first (generate_art_direction { kind: "moodboard" }), or skip mood boards (update_art_direction { skipBoards: true }).`,
        ),
      );
    }
  }

  const taken = new Set<string>();
  const jobs: Job[] = [];
  for (const d of wanted) {
    if (revise) {
      for (let i = 0; i < (body.count ?? artDirection.mockCount); i++) {
        jobs.push({
          direction: d,
          prompt: revisePrompt(brief, revise.instruction),
          reference: revise.mock,
          revise,
          storeAt: nextName(id, d, kind, taken),
        });
      }
      continue;
    }
    if (kind === "moodboard") {
      jobs.push({
        direction: d,
        prompt: boardPrompt(brief, d),
        storeAt: nextName(id, d, kind, taken),
      });
      continue;
    }
    const board = artDirection.skipBoards ? undefined : currentBoard(d);
    const prompt = mockPrompt(brief, d, { fromBoard: board !== undefined });
    for (let i = 0; i < (body.count ?? artDirection.mockCount); i++) {
      jobs.push({
        direction: d,
        prompt,
        ...(board ? { reference: board.path } : {}),
        storeAt: nextName(id, d, kind, taken),
      });
    }
  }
  const tooLong = jobs.find((j) => j.prompt.length > MAX_IMAGE_PROMPT);
  if (tooLong) {
    return err(
      badRequest(
        `The prompt for "${tooLong.direction.title}" would be ${tooLong.prompt.length} characters, and image models take ${MAX_IMAGE_PROMPT}. Shorten the brief's copy (${brief.content.length} characters now) or the direction's words.`,
      ),
    );
  }

  const model = body.model ?? artDirection.models[kind];
  const left = new Map(
    wanted.map((d) => [d.id, jobs.filter((j) => j.direction.id === d.id).length]),
  );
  const finish = new Map(
    wanted.map((d) => [
      d.id,
      track(ctx, id, { direction: d.id, kind, count: left.get(d.id) ?? 0 }),
    ]),
  );
  const made: ArtDirectionGenerateResult["made"] = [];
  const failed: ArtDirectionGenerateResult["failed"] = [];
  let charged = 0;
  let balance: number | undefined;

  const draw = async (job: Job) => {
    const dir = job.direction.id;
    const r = await generateArtDirectionImage(ctx.folder.root, cloud, {
      intent: kind,
      prompt: job.prompt,
      model,
      ...(job.reference ? { reference: [job.reference] } : {}),
      storeAt: job.storeAt,
    });
    if (r.ok) {
      charged += r.value.chargedMicros;
      balance =
        balance === undefined ? r.value.balanceMicros : Math.min(balance, r.value.balanceMicros);
      const image: ArtDirectionImage = {
        path: r.value.assetPath,
        model: r.value.model,
        prompt: job.prompt,
        ...(job.revise
          ? { revisedFrom: job.revise.mock, instruction: job.revise.instruction.trim() }
          : job.reference
            ? { fromBoard: job.reference }
            : {}),
        ...(r.value.width && r.value.height
          ? { width: r.value.width, height: r.value.height }
          : {}),
        createdAt: new Date().toISOString(),
      };
      // Recorded as it lands, so the canvas shows it without waiting for the rest.
      const recorded = await change(ctx, id, (current) => {
        const directions = current.directions.map((d) =>
          d.id !== dir
            ? d
            : kind === "moodboard"
              ? { ...d, boards: [...d.boards, image] }
              : { ...d, mocks: [...d.mocks, image] },
        );
        const stage = atLeast(current.stage, kind === "moodboard" ? "boards" : "mocks");
        return ok({ next: { ...current, directions, stage }, value: undefined });
      });
      // The image is paid for and on disk; a lost record is worth saying, not
      // worth failing the run over.
      if (recorded.ok) made.push({ direction: dir, kind, path: r.value.assetPath });
      else
        failed.push({
          direction: dir,
          message: "The image was made but the art direction couldn't record it.",
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
  if (made.length > 0) emitActivity(ctx, "generate_art_direction", {});
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

/** Delete one art direction image: its file and its record. */
export function removeArtDirectionImage(
  ctx: MutationContext,
  id: string,
  path: string,
): Promise<Result<ArtDirectionFile, MutationError>> {
  return change(ctx, id, (current) => {
    let found = false;
    const directions = current.directions.map((d) => {
      const boards = d.boards.filter((b) => b.path !== path);
      const mocks = d.mocks.filter((m) => m.path !== path);
      if (boards.length !== d.boards.length || mocks.length !== d.mocks.length) found = true;
      return { ...d, boards, mocks };
    });
    if (!found) return err(badRequest(`"${path}" isn't an art direction image.`));
    const chosen = current.chosen.filter((c) => c.image !== path);
    if (path.startsWith(`assets/${IMAGE_DIR}/`) && !path.includes("..")) {
      const root = ctx.folder.root;
      void rm(join(root, path), { force: true })
        .then(() => (drawing(root) ? false : pruneEmpty(join(root, "assets", IMAGE_DIR))))
        .catch(() => {});
    }
    const next = { ...current, directions, chosen };
    return ok({ next, value: next });
  });
}
