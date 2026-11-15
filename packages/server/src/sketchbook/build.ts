import type { BuildSketchbookBody } from "@velloo/protocol";
import { err, ok, type Result } from "@velloo/result";
import { type SketchbookDirection, sketchbookName } from "@velloo/schema";
import { addBoard } from "../mutations/api/boards.ts";
import { badRequest, type MutationError } from "../mutations/errors.ts";
import type { MutationContext } from "../mutations/index.ts";
import { lookFromSketchbook } from "../theme/looks.ts";
import { readSketchbook, recordBuild, updateSketchbook } from "./sketchbook.ts";

/** Board names are short; the sketchbook's name and the direction's title are cut to fit. */
function boardName(name: string, d: SketchbookDirection): string {
  const cut = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);
  return `${cut(name, 28)} · ${cut(d.title, 28)}`;
}

/** The Look a direction is kept as: the one made from it before, else a new one from its proposal. */
async function lookOf(
  ctx: MutationContext,
  id: string,
  direction: string,
): Promise<Result<string, MutationError>> {
  for (const [name, look] of ctx.folder.looks) {
    if (look.origin?.sketchbook === id && look.origin.direction === direction) return ok(name);
  }
  const made = await lookFromSketchbook(ctx, { sketchbook: id, direction });
  if (made.ok) return ok(made.value.name);
  const e = made.error;
  return err(badRequest("message" in e ? e.message : "reason" in e ? e.reason : e.kind));
}

/**
 * Hand the choices to the agent to design screens from: record them and what
 * the person said, keep each chosen direction as a Look (the one made from it
 * before, or a new one from its proposal) and give it a board pinned to that
 * Look (again, if theirs was deleted), so the canvas can show the boards while
 * the agent works.
 */
export async function buildSketchbook(
  ctx: MutationContext,
  id: string,
  body: BuildSketchbookBody,
): Promise<
  Result<
    { boardId: string; boards: Record<string, string>; looks: Record<string, string> },
    MutationError
  >
> {
  const updated = await updateSketchbook(ctx, id, {
    chosen: body.chosen,
    generateImages: body.generateImages,
  });
  if (!updated.ok) return updated;
  const read = await readSketchbook(ctx.folder.root, id);
  if (!read || read.problem)
    return err(badRequest(read?.problem ?? `There's no sketchbook "${id}".`));
  const sketchbook = read.sketchbook;
  const name = sketchbookName(sketchbook);
  const boards: Record<string, string> = {};
  const looks: Record<string, string> = {};
  for (const directionId of new Set(sketchbook.chosen.map((c) => c.direction))) {
    const d = sketchbook.directions.find((x) => x.id === directionId);
    if (!d) continue;
    const look = await lookOf(ctx, id, d.id);
    if (!look.ok) return look;
    looks[d.id] = look.value;
    const held = sketchbook.buildBoards[d.id];
    if (held && ctx.folder.boards.has(held)) {
      boards[d.id] = held;
      continue;
    }
    const made = await addBoard(ctx, {
      name: boardName(name, d),
      ...(look.value === "default" ? {} : { theme: look.value }),
    });
    if (!made.ok) return made;
    boards[d.id] = made.value.boardId;
  }
  const recorded = await recordBuild(ctx, id, {
    boards,
    notes: body.instructions,
    withBoards: body.withBoards,
  });
  if (!recorded.ok) return recorded;
  const first = boards[sketchbook.chosen[0]?.direction ?? ""] ?? Object.values(boards)[0] ?? "";
  return ok({ boardId: first, boards, looks });
}
