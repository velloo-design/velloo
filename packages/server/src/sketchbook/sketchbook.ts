import { readdir, readFile, rm, rmdir } from "node:fs/promises";
import { join } from "node:path";
import {
  formatCredits,
  type GenerateSketchbookBody,
  kindLabel,
  MOCK_KINDS,
  SKETCHBOOK_LIMITS,
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
  referencesOf,
  SKETCHBOOK_STAGES,
  type SketchbookChoice,
  type SketchbookDirection,
  type SketchbookFile,
  SketchbookFileSchema,
  type SketchbookImage,
  type SketchbookReference,
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
import { badRequest, type MutationError } from "../mutations/errors.ts";
import type { MutationContext } from "../mutations/index.ts";
import { applyProposal, describeProposalError } from "../theme/proposal.ts";
import {
  kindPrompt,
  MAX_IMAGE_PROMPT,
  PROMPTED_KINDS,
  type PromptReference,
  revisePrompt,
} from "./prompts.ts";
import { makeReference, referenceId } from "./references.ts";

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
    for (const reference of read.sketchbook.references) kept.add(reference.path);
  }
  const base = join(root, "assets", IMAGE_DIR);
  for (const path of await filesUnder(base, `assets/${IMAGE_DIR}`)) {
    if (!kept.has(path)) await rm(join(root, path), { force: true });
  }
  await pruneEmpty(base);
}

/** Folders swept since the daemon started: once each, for what a hand-deleted file left. */
const swept = new Set<string>();

/** Waits for the folder's pending writes, and sweeps it the first time it is read. */
const settled = (root: string) =>
  serialize(root, async () => {
    if (swept.has(root)) return;
    swept.add(root);
    await sweep(root).catch(() => {});
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
  await settled(root);
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
    buildBoards: sketchbook.buildBoards,
    ...(newest ? { cover: newest.path } : {}),
    directions: sketchbook.directions.length,
    images: images.length,
  };
}

/** Every sketchbook that reads, whole, for what is read across them (the links). */
export async function readSketchbooks(
  root: string,
): Promise<{ id: string; sketchbook: SketchbookFile }[]> {
  await settled(root);
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
  await settled(root);
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
  await settled(root);
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
/** References being made per folder: like a drawn image, each is on disk before it is recorded. */
const addingReferences = new Map<string, number>();

/** Whether any image is being drawn in the folder: it is on disk before it is recorded. */
const drawing = (root: string): boolean =>
  (addingReferences.get(root) ?? 0) > 0 ||
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
  const ask = sketchbook.inspiration.custom;
  const longest = (kind: string) =>
    brief
      ? active
          .filter((d) => d.picked)
          .map(
            (d) =>
              kindPrompt(
                kind,
                brief,
                d,
                attachmentsFor(sketchbook, d, kind, MAX_ATTACHED, { ask }).options,
              )?.length ?? 0,
          )
          .reduce((a, b) => Math.max(a, b), 0)
      : 0;
  return Object.fromEntries(PROMPTED_KINDS.map((k) => [k, longest(k)]));
}

/** The mood board an image of `kind` is drawn from: the direction's current one, when it has one. */
const boardFor = (d: SketchbookDirection, kind: string) =>
  kind === "moodboard" ? undefined : latestOf(d, "moodboard");

/**
 * The inspiration a page is drawn from beside its mood board: the latest
 * image of each other kind that isn't a page, newest first.
 */
function inspirationFor(d: SketchbookDirection, kind: string): SketchbookImage[] {
  if (!PAGE_IMAGE_KINDS.includes(kind)) return [];
  const kinds = [...new Set(d.images.map((i) => i.kind))].filter(
    (k) => k !== "moodboard" && !PAGE_IMAGE_KINDS.includes(k),
  );
  return kinds
    .flatMap((k) => [latestOf(d, k)].filter((i) => i !== undefined))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** The most images a cloud takes with one prompt. */
const MAX_ATTACHED = 3;

/**
 * The images sent with a direction's image of `kind`, in order, and what the
 * prompt says of them: its mood board, a remix's parents' mood boards (for
 * its own mood board), then its references, cut to the `max` the kind takes
 * and to the references whose words still fit the prompt's `limit`.
 */
function attachmentsFor(
  sketchbook: SketchbookFile,
  d: SketchbookDirection,
  kind: string,
  max: number,
  words: { focus?: string | undefined; ask?: string | undefined } = {},
  limit = MAX_IMAGE_PROMPT,
): { paths: string[]; board?: SketchbookImage; options: Parameters<typeof kindPrompt>[3] } {
  const board = max > 0 ? boardFor(d, kind) : undefined;
  const art = [...(board ? [board] : []), ...(max > 0 ? inspirationFor(d, kind) : [])].slice(
    0,
    max,
  );
  const paths = art.map((i) => i.path);
  const parents =
    kind === "moodboard"
      ? d.remixOf.flatMap((id) => sketchbook.directions.filter((p) => p.id === id))
      : [];
  let boards = 0;
  for (const parent of parents) {
    const parentBoard = latestOf(parent, "moodboard");
    if (parentBoard && paths.length < max) {
      paths.push(parentBoard.path);
      boards++;
    }
  }
  const references: (PromptReference & { path: string })[] = [];
  for (const ref of referencesOf(sketchbook, d)) {
    if (paths.length + references.length >= max) break;
    references.push({ note: ref.note, url: ref.url, path: ref.path });
  }
  const options = (refs: PromptReference[]) => ({
    fromBoard: art.length > 0,
    art: art.map((i) => kindLabel(i.kind).toLowerCase()),
    subject: sketchbook.subject,
    focus: words.focus,
    ask: words.ask,
    ...(parents.length === 2
      ? { remix: { titles: parents.map((p) => p.title), take: d.take, boards } }
      : {}),
    references: refs,
  });
  // A page drawn from words alone has the least room: references go from the last.
  const brief = sketchbook.brief;
  while (
    brief &&
    references.length > 0 &&
    (kindPrompt(kind, brief, d, options(references))?.length ?? 0) > limit
  ) {
    references.pop();
  }
  return {
    paths: [...paths, ...references.map((r) => r.path)],
    ...(board ? { board } : {}),
    options: options(references),
  };
}

// --- edits -------------------------------------------------------------------

const stageIndex = (s: SketchbookStage) => SKETCHBOOK_STAGES.indexOf(s);
/** Move the stage forward to `to`, never back (going back is the person's call). */
const atLeast = (current: SketchbookStage, to: SketchbookStage): SketchbookStage =>
  stageIndex(current) >= stageIndex(to) ? current : to;

/**
 * Whether a choice holds: its direction is there, and its image, when it
 * names one, is the direction's and can be designed from.
 */
function choiceHolds(directions: SketchbookDirection[], c: SketchbookChoice): boolean {
  const d = directions.find((x) => x.id === c.direction);
  if (!d) return false;
  if (c.image === undefined) return true;
  const image = d.images.find((i) => i.path === c.image);
  return image !== undefined && designsScreens(image.kind);
}

/** Begin a new sketchbook, beside any the design already has. */
export async function createSketchbook(
  ctx: MutationContext,
  body: Pick<UpdateSketchbookBody, "origin" | "page" | "name" | "agentSession" | "subject"> = {},
): Promise<Result<SketchbookState, MutationError>> {
  const root = ctx.folder.root;
  await settled(root);
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
  const root = ctx.folder.root;
  const added: SketchbookReference[] = [];
  let failed: MutationError | undefined;
  const additions = body.references?.filter((p) => !p.remove) ?? [];
  if (additions.length > 0) {
    const read = await readSketchbook(root, id);
    if (!read) return err(missing(id));
    const taken = read.sketchbook.references.map((r) => r.id);
    const fresh = additions.filter((p) => !(p.id && taken.includes(p.id)));
    if (fresh.length > 0) {
      addingReferences.set(root, (addingReferences.get(root) ?? 0) + 1);
      try {
        for (const patch of fresh) {
          const refId =
            patch.id ??
            referenceId(patch.url ?? patch.path?.split("/").pop() ?? patch.captureId ?? "ref", [
              ...taken,
              ...added.map((r) => r.id),
            ]);
          const made = await makeReference(ctx, id, refId, patch);
          if (!made.ok) {
            failed = made.error;
            break;
          }
          added.push(made.value);
        }
      } finally {
        addingReferences.set(root, (addingReferences.get(root) ?? 1) - 1);
      }
    }
  }
  const r = failed ? err(failed) : await editSketchbook(ctx, id, body, added);
  // A removed direction's images go with it, a removed reference's image with
  // it, and the files of references that were made but not recorded.
  if (
    body.removeDirections?.length ||
    body.references?.some((p) => p.remove) ||
    (!r.ok && added.length > 0)
  ) {
    await serialize(root, () => sweep(root));
  }
  return r;
}

/** A remix's description: what it takes, then both parents' words, cut to fit a prompt. */
function remixDescription(a: SketchbookDirection, b: SketchbookDirection, take: string): string {
  const head = `A remix of ${a.title} and ${b.title}, taking ${take.trim().replace(/[.!?]+$/, "")}.`;
  const room = Math.floor((SKETCHBOOK_LIMITS.description - head.length) / 2) - 12;
  const cut = (text: string) => {
    const t = text.trim();
    if (t.length <= room) return t;
    const at = t.lastIndexOf(" ", room - 1);
    return `${t.slice(0, at > room / 2 ? at : room - 1)}…`;
  };
  return [head, `${a.title}: ${cut(a.description)}`, `${b.title}: ${cut(b.description)}`]
    .join(" ")
    .slice(0, SKETCHBOOK_LIMITS.description);
}

/** A direction id from a title, clear of the ids taken. */
function directionId(title: string, taken: readonly string[]): string {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "remix";
  for (let n = 1; ; n++) {
    const id = n === 1 ? base : `${base}-${n}`;
    if (!taken.includes(id)) return id;
  }
}

function editSketchbook(
  ctx: MutationContext,
  id: string,
  body: UpdateSketchbookBody,
  added: SketchbookReference[] = [],
): Promise<Result<SketchbookFile, MutationError>> {
  return change(ctx, id, (current) => {
    let directions = [...current.directions];
    let references = [...current.references];
    for (const patch of body.references ?? []) {
      const at = patch.id === undefined ? -1 : references.findIndex((r) => r.id === patch.id);
      if (at < 0) {
        if (patch.remove) return err(badRequest(`There's no reference "${patch.id}" to remove.`));
        continue;
      }
      if (patch.remove) references.splice(at, 1);
      else if (patch.note !== undefined) {
        references[at] = { ...(references[at] as SketchbookReference), note: patch.note.trim() };
      }
    }
    references = [...references, ...added];
    const refIds = new Set(references.map((r) => r.id));
    // A removed reference goes from every direction that named it.
    directions = directions.map((d) =>
      d.references.every((r) => refIds.has(r))
        ? d
        : { ...d, references: d.references.filter((r) => refIds.has(r)) },
    );
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
          references: patch.references ?? [],
          remixOf: [],
          take: "",
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
          ...(patch.references !== undefined ? { references: patch.references } : {}),
        };
      }
      const unknownRef = patch.references?.find((r) => !refIds.has(r));
      if (unknownRef !== undefined) {
        return err(
          badRequest(
            `There's no reference "${unknownRef}"; the sketchbook's are ${[...refIds].map((r) => `"${r}"`).join(", ") || "none yet (add one with references: [{ url | path, note }])"}.`,
          ),
        );
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
    if (body.remix) {
      const [a, b] = body.remix.from.map((from) => directions.find((d) => d.id === from));
      if (!a || !b || a === b) {
        return err(
          badRequest(
            `A remix takes two different directions of the sketchbook; it has ${directions.map((d) => `"${d.id}"`).join(", ") || "none"}.`,
          ),
        );
      }
      const title = (body.remix.title ?? `${a.title} × ${b.title}`).slice(0, 80);
      const taken = directions.map((d) => d.id);
      if (body.remix.id !== undefined && taken.includes(body.remix.id)) {
        return err(badRequest(`There's a direction "${body.remix.id}" already.`));
      }
      directions.push({
        id: body.remix.id ?? directionId(title, taken),
        title,
        description: remixDescription(a, b, body.remix.take),
        layout: a.layout || b.layout,
        dropped: false,
        picked: true,
        images: [],
        proposal: null,
        references: [],
        remixOf: [a.id, b.id],
        take: body.remix.take.trim(),
      });
    }
    if (body.removeDirections?.length) {
      const gone = new Set(body.removeDirections);
      directions = directions.filter((d) => !gone.has(d.id));
    }
    const wrong = (body.chosen ?? []).find((c) => !choiceHolds(directions, c));
    if (wrong) {
      return err(
        badRequest(
          !directions.some((d) => d.id === wrong.direction)
            ? `There is no direction "${wrong.direction}" in the sketchbook.`
            : `There is no mock, mood board or other page image "${wrong.image}" in direction "${wrong.direction}" (palettes, type posters, UI kits, imagery and icons go with the screens, not one each; leave \`image\` out to design from the direction alone); read the sketchbook for the images it has.`,
        ),
      );
    }
    // A choice whose direction or image was removed goes with it.
    const chosen = (body.chosen ?? current.chosen).filter((c) => choiceHolds(directions, c));
    const outputs = current.outputs.filter((o) => directions.some((d) => d.id === o.direction));
    const at = new Date().toISOString();
    for (const o of body.outputs ?? []) {
      const direction = o.image
        ? findSketchbookImage({ directions }, o.image)?.direction
        : directions.find((d) => d.id === o.direction);
      if (!direction || (o.image && o.direction && o.direction !== direction.id)) {
        return err(
          badRequest(
            o.image
              ? `There is no image "${o.image}"${o.direction ? ` in direction "${o.direction}"` : ""}; an output names the image its screen was built from.`
              : `An output names the image its screen was built from, or for one designed from a direction alone, the \`direction\`${o.direction ? `; there is no direction "${o.direction}"` : ""}.`,
          ),
        );
      }
      if (!ctx.folder.screens.has(o.screen)) {
        return err(
          badRequest(`There is no screen "${o.screen}"; record a screen once it is composed.`),
        );
      }
      const record = {
        screen: o.screen,
        direction: direction.id,
        ...(o.image ? { image: o.image } : {}),
        at,
      };
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
      references,
      inspiration: body.inspiration
        ? { kinds: [...new Set(body.inspiration.kinds)], custom: body.inspiration.custom.trim() }
        : current.inspiration,
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
 * The theme a direction proposes: its proposal over `base`
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

/** Record a build: the boards its screens go on, by direction, and what the person added. */
export function recordBuild(
  ctx: MutationContext,
  id: string,
  build: { boards: Record<string, string>; notes: string; withBoards: boolean },
): Promise<Result<SketchbookFile, MutationError>> {
  return change(ctx, id, (current) => {
    const next: SketchbookFile = {
      ...current,
      stage: "screens",
      buildBoards: { ...current.buildBoards, ...build.boards },
      buildNotes: build.notes.trim(),
      buildWithBoards: build.withBoards,
    };
    return ok({ next, value: next });
  });
}

/**
 * A screen that lands on a direction's build board while the agent works
 * through the choices is linked to the one choice of that direction no screen
 * was built from yet — the agent is told to record each output, and this
 * catches the one it forgot. When more than one choice or screen is
 * unaccounted for, which went with which is the agent's to say, so nothing is
 * guessed.
 */
export async function linkBuiltScreens(ctx: MutationContext, boardId: string): Promise<void> {
  const board = ctx.folder.boards.get(boardId);
  if (!board) return;
  for (const { id, sketchbook } of await readSketchbooks(ctx.folder.root)) {
    if (sketchbook.stage !== "screens") continue;
    const direction = Object.entries(sketchbook.buildBoards).find(([, b]) => b === boardId)?.[0];
    if (direction === undefined) continue;
    const built = new Set(sketchbook.outputs.map((o) => o.screen));
    const open = sketchbook.chosen.filter(
      (c) =>
        c.direction === direction &&
        !sketchbook.outputs.some(
          (o) => o.direction === direction && (o.image ?? null) === (c.image ?? null),
        ),
    );
    const screens = [
      ...new Set(board.frames.map((f) => f.screen).filter((s) => ctx.folder.screens.has(s))),
    ].filter((s) => !built.has(s));
    const [choice] = open;
    const [screen] = screens;
    if (open.length !== 1 || screens.length !== 1 || !choice || !screen) continue;
    await editSketchbook(ctx, id, {
      outputs: [
        { screen, ...(choice.image ? { image: choice.image } : { direction: choice.direction }) },
      ],
    });
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
  if (!(await readSketchbook(root, id))) return err(missing(id));
  await serialize(root, async () => {
    // A Look keeps what it shows; without knowing what that is, every image stays.
    const kept = await lookImages(root);
    if (kept) {
      const own = await filesUnder(
        join(root, "assets", IMAGE_DIR, id),
        `assets/${IMAGE_DIR}/${id}`,
      );
      for (const path of own) {
        if (!kept.has(path)) await rm(join(root, path), { force: true });
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
  /** The images sent with the prompt, in order. */
  references: string[];
  /** The mood board it is drawn from, when it is the first of them. */
  board?: string;
  /** For a revision: the image it revises, and what was asked. */
  revise?: { image: string; instruction: string };
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
  const { kinds, listed } = await fetchSketchbookKinds(cloud, PROMPTED_KINDS);
  // A custom image is drawn on the imagery intent by a cloud with no intent of its own for it.
  const intent = kind === "custom" && !kinds.some((k) => k.intent === "custom") ? "imagery" : kind;
  const offered = kinds.find((k) => k.intent === intent);
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
  if (body.ask !== undefined && kind !== "custom") {
    return err(badRequest('`ask` says what a custom image shows: send it with kind: "custom".'));
  }
  // A kind whose intent takes no references is drawn from the direction's words.
  const takesReference = offered.reference !== "forbidden" && offered.maxReferences !== 0;
  const maxAttached = takesReference
    ? Math.min(MAX_ATTACHED, offered.maxReferences ?? MAX_ATTACHED)
    : 0;
  const revise = body.revise;
  const revisedOf = revise ? findSketchbookImage(sketchbook, revise.image) : undefined;
  if (revise && (!revisedOf || revisedOf.image.kind !== kind || !takesReference)) {
    return err(
      badRequest(
        !revisedOf
          ? `There is no image "${revise.image}"; read the sketchbook for the images it has.`
          : revisedOf.image.kind !== kind
            ? `"${revise.image}" is a ${revisedOf.image.kind}: send kind: "${revisedOf.image.kind}".`
            : `velloo-cloud draws a ${kind} without reference images, so it can't redraw one with a change: draw it again instead.`,
      ),
    );
  }
  const ask = (revisedOf?.image.ask ?? body.ask ?? sketchbook.inspiration.custom).trim();
  if (kind === "custom" && !ask) {
    return err(
      badRequest(
        'A custom image needs `ask`, what it shows in the direction\'s look ("the product on a desk at night").',
      ),
    );
  }
  const revised = revisedOf?.direction;
  const wanted = revised
    ? [revised]
    : body.directions
      ? sketchbook.directions.filter((d) => body.directions?.includes(d.id))
      : activeDirections(sketchbook).filter((d) => d.picked);
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
        activeDirections(sketchbook).length === 0
          ? "There are no directions in the running; add some first."
          : "No direction is picked; pick one (update_sketchbook { directions: [{ id, picked: true }] }).",
      ),
    );
  }
  const limit = Math.min(MAX_IMAGE_PROMPT, offered.maxPromptChars ?? MAX_IMAGE_PROMPT);
  const taken = new Set<string>();
  const jobs: Job[] = [];
  const pages = kind === "mock" || (revise !== undefined && PAGE_IMAGE_KINDS.includes(kind));
  const times = body.count ?? (pages ? sketchbook.mockCount : 1);
  for (const d of wanted) {
    if (revise) {
      for (let i = 0; i < times; i++) {
        jobs.push({
          direction: d,
          prompt: revisePrompt(brief, revise.instruction, kind),
          references: [revise.image],
          revise,
          storeAt: nextName(id, d, kind, taken),
        });
      }
      continue;
    }
    const sent = attachmentsFor(
      sketchbook,
      d,
      kind,
      maxAttached,
      { focus: body.focus, ask },
      limit,
    );
    const prompt = kindPrompt(kind, brief, d, sent.options) as string;
    for (let i = 0; i < times; i++) {
      jobs.push({
        direction: d,
        prompt,
        references: sent.paths,
        ...(sent.board ? { board: sent.board.path } : {}),
        storeAt: nextName(id, d, kind, taken),
      });
    }
  }
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
      intent,
      prompt: job.prompt,
      model,
      aspect: body.aspect,
      ...(job.references.length > 0 ? { reference: job.references } : {}),
      storeAt: job.storeAt,
    });
    if (r.ok) {
      charged += r.value.chargedMicros;
      balance =
        balance === undefined ? r.value.balanceMicros : Math.min(balance, r.value.balanceMicros);
      const others = job.references.filter((p) => p !== job.board && p !== job.revise?.image);
      const image: SketchbookImage = {
        kind,
        path: r.value.assetPath,
        model: r.value.model,
        prompt: job.prompt,
        ...(job.revise
          ? { revisedFrom: job.revise.image, instruction: job.revise.instruction.trim() }
          : job.board
            ? { fromBoard: job.board }
            : {}),
        ...(others.length > 0 ? { sentWith: others } : {}),
        ...(body.focus?.trim() ? { focus: body.focus.trim() } : {}),
        ...(kind === "custom" ? { ask } : {}),
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
        const stage = atLeast(current.stage, MOCK_KINDS.includes(kind) ? "mocks" : "inspiration");
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
