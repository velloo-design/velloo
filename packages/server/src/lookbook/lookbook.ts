import { readFileSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type {
  GenerateLookbookBody,
  LookbookGenerateResult,
  LookbookPending,
  LookbookRequestBody,
  LookbookState,
  UpdateLookbookBody,
} from "@velloo/protocol";
import { err, ok, type Result } from "@velloo/result";
import {
  activeDirections,
  currentBoard,
  EMPTY_LOOKBOOK,
  LOOKBOOK_STAGES,
  type LookbookDirection,
  type LookbookFile,
  LookbookFileSchema,
  type LookbookImage,
  type LookbookStage,
} from "@velloo/schema";
import { emitActivity } from "../activity.ts";
import type { CloudAuth } from "../cloud.ts";
import {
  describeGenerateFailure,
  formatDollars,
  generateLookbookImage,
} from "../cloud-generate.ts";
import { writeJsonAtomic } from "../fs.ts";
import { badRequest, type MutationError } from "../mutations/errors.ts";
import type { MutationContext } from "../mutations/index.ts";
import { boardPrompt, MAX_IMAGE_PROMPT, mockPrompt } from "./prompts.ts";

/**
 * The design folder's `lookbook.json` (see the schema for what the lookbook is).
 *
 * Kept out of `DesignFolder`, like `assets.json`: nothing renders from it, a
 * generation that takes minutes must not hold a lock the screens share, and a
 * corrupt file should cost the lookbook, not the canvas. Writes are serialized
 * per folder; generation reads, draws with no lock held, then appends.
 */

const lookbookPath = (root: string) => join(root, "lookbook.json");
const IMAGE_DIR = "lookbook";

type Read = { lookbook: LookbookFile; started: boolean; problem?: string };

export async function readLookbook(root: string): Promise<Read> {
  let raw: string;
  try {
    raw = await readFile(lookbookPath(root), "utf8");
  } catch {
    return { lookbook: EMPTY_LOOKBOOK, started: false };
  }
  try {
    const parsed = LookbookFileSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return { lookbook: parsed.data, started: true };
    return {
      lookbook: EMPTY_LOOKBOOK,
      started: true,
      problem: `lookbook.json doesn't match the schema: ${parsed.error.issues[0]?.message ?? "invalid"}`,
    };
  } catch {
    return { lookbook: EMPTY_LOOKBOOK, started: true, problem: "lookbook.json isn't valid JSON" };
  }
}

/**
 * How many asks wait on an agent, read synchronously: the MCP brief is built
 * before any tool runs, and says so the way it says comments are waiting.
 */
export function countLookbookRequestsSync(root: string): number {
  try {
    const parsed = LookbookFileSchema.safeParse(
      JSON.parse(readFileSync(lookbookPath(root), "utf8")),
    );
    return parsed.success ? parsed.data.requests.length : 0;
  } catch {
    return 0;
  }
}

const chains = new Map<string, Promise<unknown>>();
function serialize<T>(root: string, op: () => Promise<T>): Promise<T> {
  const next = (chains.get(root) ?? Promise.resolve()).then(op, op);
  chains.set(
    root,
    next.catch(() => {}),
  );
  return next;
}

/** Read, change and write under the folder's chain; broadcast when it lands. */
async function change<T>(
  ctx: MutationContext,
  fn: (lookbook: LookbookFile) => Result<{ next: LookbookFile; value: T }, MutationError>,
): Promise<Result<T, MutationError>> {
  const result = await serialize(ctx.folder.root, async () => {
    const read = await readLookbook(ctx.folder.root);
    if (read.problem) return err(badRequest(`${read.problem}; fix or delete the file.`));
    const r = fn(read.lookbook);
    if (!r.ok) return r;
    await writeJsonAtomic(lookbookPath(ctx.folder.root), LookbookFileSchema.parse(r.value.next));
    return ok(r.value.value);
  });
  if (result.ok) ctx.broadcast({ type: "lookbook-changed" });
  return result;
}

// --- in-flight generations ----------------------------------------------------

const pendingByRoot = new Map<string, LookbookPending[]>();

const pendingFor = (root: string): LookbookPending[] => pendingByRoot.get(root) ?? [];

function track(ctx: MutationContext, entry: LookbookPending): () => void {
  const root = ctx.folder.root;
  pendingByRoot.set(root, [...pendingFor(root), entry]);
  ctx.broadcast({ type: "lookbook-changed" });
  return () => {
    pendingByRoot.set(
      root,
      pendingFor(root).filter((p) => p !== entry),
    );
    ctx.broadcast({ type: "lookbook-changed" });
  };
}

export async function lookbookState(root: string): Promise<LookbookState> {
  const read = await readLookbook(root);
  return { lookbook: read.lookbook, started: read.started, pending: pendingFor(root) };
}

// --- edits -------------------------------------------------------------------

const stageIndex = (s: LookbookStage) => LOOKBOOK_STAGES.indexOf(s);
/** Move the stage forward to `to`, never back (going back is the person's call). */
const atLeast = (current: LookbookStage, to: LookbookStage): LookbookStage =>
  stageIndex(current) >= stageIndex(to) ? current : to;

function findImage(lookbook: LookbookFile, direction: string, path: string) {
  const d = lookbook.directions.find((x) => x.id === direction);
  return d?.mocks.find((m) => m.path === path);
}

export function updateLookbook(
  ctx: MutationContext,
  body: UpdateLookbookBody,
): Promise<Result<LookbookFile, MutationError>> {
  return change(ctx, (current) => {
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
        const d = directions[i] as LookbookDirection;
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
    let chosen = body.chosen === undefined ? current.chosen : body.chosen;
    if (chosen) {
      const probe = { ...current, directions };
      if (!findImage(probe, chosen.direction, chosen.mock)) {
        return err(
          badRequest(
            `There is no mock "${chosen.mock}" in direction "${chosen.direction}"; read the lookbook for the mocks it has.`,
          ),
        );
      }
    }
    if (chosen && !directions.some((d) => d.id === chosen?.direction)) chosen = null;
    const requests =
      body.resolveRequests === "all"
        ? []
        : body.resolveRequests
          ? current.requests.filter((r) => !body.resolveRequests?.includes(r.id))
          : current.requests;
    let stage = body.stage ?? current.stage;
    // Writing the brief or the first directions moves the lookbook on, so the
    // canvas follows the agent without a separate stage call.
    if (body.stage === undefined) {
      if (body.brief) stage = atLeast(stage, "brief");
      if (directions.length > 0 && current.directions.length === 0) {
        stage = atLeast(stage, "directions");
      }
      if (body.chosen) stage = atLeast(stage, "build");
    }
    const next: LookbookFile = {
      ...current,
      stage,
      brief: body.brief ?? current.brief,
      directions,
      skipBoards: body.skipBoards ?? current.skipBoards,
      mockCount: body.mockCount ?? current.mockCount,
      models: { ...current.models, ...body.models },
      chosen,
      requests,
    };
    emitActivity(ctx, "update_lookbook", {});
    return ok({ next, value: next });
  });
}

export function addLookbookRequest(
  ctx: MutationContext,
  body: LookbookRequestBody,
): Promise<Result<LookbookFile, MutationError>> {
  return change(ctx, (current) => {
    const request = {
      ...body,
      id: `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      createdAt: new Date().toISOString(),
    };
    const next = { ...current, requests: [...current.requests, request] };
    return ok({ next, value: next });
  });
}

// --- generation --------------------------------------------------------------

/** Generations a person or agent runs at once; the cloud allows ten a minute. */
const PARALLEL = 3;

async function inParallel<T>(jobs: (() => Promise<T>)[]): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(PARALLEL, jobs.length) }, async () => {
      for (let i = next++; i < jobs.length; i = next++)
        out[i] = await (jobs[i] as () => Promise<T>)();
    }),
  );
  return out;
}

/**
 * The next free name for a direction's board or mock, without its extension:
 * the cloud's reply decides that (JPEG, from a cloud that sends it).
 */
function nextName(d: LookbookDirection, kind: "moodboard" | "mock", taken: Set<string>): string {
  const stem = kind === "moodboard" ? "board" : "mock";
  const existing = new Set([...d.boards, ...d.mocks].map((i) => i.path.replace(/\.[a-z]+$/, "")));
  for (let n = 1; ; n++) {
    const rel = `${IMAGE_DIR}/${d.id}/${stem}-${n}`;
    if (!existing.has(`assets/${rel}`) && !taken.has(rel)) {
      taken.add(rel);
      return rel;
    }
  }
}

type Job = {
  direction: LookbookDirection;
  prompt: string;
  reference?: string;
  storeAt: string;
};

/**
 * Draw mood boards or mocks and record them. Each image is its own paid
 * generation, so one failure (a refusal, a timeout) loses only that image and
 * is reported beside the ones that landed.
 */
export async function generateLookbook(
  ctx: MutationContext,
  cloud: CloudAuth | undefined,
  body: GenerateLookbookBody,
): Promise<Result<LookbookGenerateResult, MutationError>> {
  if (!cloud?.url) {
    return err(
      badRequest(
        "Image generation needs velloo-cloud: ask the user to run `velloo login`, then try again.",
      ),
    );
  }
  const read = await readLookbook(ctx.folder.root);
  if (read.problem) return err(badRequest(`${read.problem}; fix or delete the file.`));
  const lookbook = read.lookbook;
  const brief = lookbook.brief;
  if (!brief) {
    return err(
      badRequest(
        "Write the brief first (update_lookbook { brief }): the images are drawn from it.",
      ),
    );
  }
  const kind = body.kind;
  const wanted = body.directions
    ? lookbook.directions.filter((d) => body.directions?.includes(d.id))
    : activeDirections(lookbook).filter((d) => kind === "moodboard" || d.picked);
  const unknown = (body.directions ?? []).filter(
    (id) => !lookbook.directions.some((d) => d.id === id),
  );
  if (unknown.length > 0) {
    return err(
      badRequest(`No direction ${unknown.map((u) => `"${u}"`).join(", ")} in the lookbook.`),
    );
  }
  if (wanted.length === 0) {
    return err(
      badRequest(
        kind === "mock"
          ? "No direction is picked for mocks; pick one (update_lookbook { directions: [{ id, picked: true }] })."
          : "There are no directions in the running; add some first.",
      ),
    );
  }

  const taken = new Set<string>();
  const jobs: Job[] = [];
  for (const d of wanted) {
    if (kind === "moodboard") {
      jobs.push({ direction: d, prompt: boardPrompt(brief, d), storeAt: nextName(d, kind, taken) });
      continue;
    }
    const board = lookbook.skipBoards ? undefined : currentBoard(d);
    const prompt = mockPrompt(brief, d, { fromBoard: board !== undefined });
    for (let i = 0; i < (body.count ?? lookbook.mockCount); i++) {
      jobs.push({
        direction: d,
        prompt,
        ...(board ? { reference: board.path } : {}),
        storeAt: nextName(d, kind, taken),
      });
    }
  }
  const tooLong = jobs.find((j) => j.prompt.length > MAX_IMAGE_PROMPT);
  if (tooLong) {
    return err(
      badRequest(
        `The prompt for "${tooLong.direction.id}" is ${tooLong.prompt.length} characters; the limit is ${MAX_IMAGE_PROMPT}. Shorten the brief's content or the direction's words.`,
      ),
    );
  }

  const model = body.model ?? lookbook.models[kind];
  const done = wanted.map((d) =>
    track(ctx, {
      direction: d.id,
      kind,
      count: jobs.filter((j) => j.direction.id === d.id).length,
    }),
  );
  let results: Awaited<ReturnType<typeof generateLookbookImage>>[];
  try {
    results = await inParallel(
      jobs.map(
        (job) => () =>
          generateLookbookImage(ctx.folder.root, cloud, {
            intent: kind,
            prompt: job.prompt,
            model,
            ...(job.reference ? { reference: [job.reference] } : {}),
            storeAt: job.storeAt,
          }),
      ),
    );
  } finally {
    for (const finish of done) finish();
  }

  const made: LookbookGenerateResult["made"] = [];
  const failed: LookbookGenerateResult["failed"] = [];
  const images = new Map<string, LookbookImage[]>();
  let charged = 0;
  let balance: number | undefined;
  results.forEach((r, i) => {
    const job = jobs[i] as Job;
    if (!r.ok) {
      failed.push({ direction: job.direction.id, message: describeGenerateFailure(r.error) });
      return;
    }
    charged += r.value.chargedMicros;
    balance =
      balance === undefined ? r.value.balanceMicros : Math.min(balance, r.value.balanceMicros);
    made.push({ direction: job.direction.id, kind, path: r.value.assetPath });
    const image: LookbookImage = {
      path: r.value.assetPath,
      model: r.value.model,
      prompt: job.prompt,
      ...(job.reference ? { fromBoard: job.reference } : {}),
      ...(r.value.width && r.value.height ? { width: r.value.width, height: r.value.height } : {}),
      createdAt: new Date().toISOString(),
    };
    images.set(job.direction.id, [...(images.get(job.direction.id) ?? []), image]);
  });

  if (made.length > 0) {
    const recorded = await change(ctx, (current) => {
      const directions = current.directions.map((d) => {
        const add = images.get(d.id);
        if (!add) return d;
        return kind === "moodboard"
          ? { ...d, boards: [...d.boards, ...add] }
          : { ...d, mocks: [...d.mocks, ...add] };
      });
      const next = {
        ...current,
        directions,
        stage: atLeast(current.stage, kind === "moodboard" ? "boards" : "mocks"),
      };
      return ok({ next, value: undefined });
    });
    // The images are paid for and on disk; a lost record is worth saying, not
    // worth failing the result over.
    if (!recorded.ok)
      failed.push({
        direction: "*",
        message: "The images were made but the lookbook couldn't record them.",
      });
    emitActivity(ctx, "generate_lookbook", {});
  }
  return ok({
    made,
    failed,
    ...(made.length > 0
      ? {
          cost: `cost ${formatDollars(charged)}${balance === undefined ? "" : `, balance ${formatDollars(balance)}`}`,
        }
      : {}),
  });
}

/** Delete one lookbook image: its file and its record. */
export function removeLookbookImage(
  ctx: MutationContext,
  path: string,
): Promise<Result<LookbookFile, MutationError>> {
  return change(ctx, (current) => {
    let found = false;
    const directions = current.directions.map((d) => {
      const boards = d.boards.filter((b) => b.path !== path);
      const mocks = d.mocks.filter((m) => m.path !== path);
      if (boards.length !== d.boards.length || mocks.length !== d.mocks.length) found = true;
      return { ...d, boards, mocks };
    });
    if (!found) return err(badRequest(`"${path}" isn't a lookbook image.`));
    const chosen = current.chosen?.mock === path ? null : current.chosen;
    if (path.startsWith(`assets/${IMAGE_DIR}/`) && !path.includes("..")) {
      void rm(join(ctx.folder.root, path), { force: true }).catch(() => {});
    }
    return ok({
      next: { ...current, directions, chosen },
      value: { ...current, directions, chosen },
    });
  });
}
