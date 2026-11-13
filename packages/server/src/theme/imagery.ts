import type { MutationContext } from "../mutations/index.ts";

/**
 * The intents that draw a photograph or an illustration, and take a reference
 * image as style guidance. A Look's imagery style goes with these and no other:
 * an icon, a vector or an edit has a look of its own, or its source.
 */
const STYLED_INTENTS = new Set(["photo", "illustration", "graphic"]);

/** The cloud takes three references a generation. */
const MAX_REFERENCES = 3;

export interface ImageryStyle {
  /** The Look it came from. */
  look: string;
  /** Its latest imagery-style image, sent as a style reference. */
  image?: string;
  /** Its imagery note, appended to the prompt. */
  note?: string;
}

/**
 * The imagery style a generated picture follows: the Look of `boardId` (the
 * default Look without one), when that Look has an imagery image or note.
 */
export function imageryStyle(
  ctx: Pick<MutationContext, "folder">,
  boardId: string | undefined,
): ImageryStyle | null {
  const name = (boardId ? ctx.folder.boards.get(boardId)?.theme : undefined) ?? "default";
  const look = ctx.folder.looks.get(name);
  if (!look) return null;
  const image = look.images.findLast((i) => i.kind === "imagery")?.path;
  const note = look.imagery.trim();
  if (!image && !note) return null;
  return { look: name, ...(image ? { image } : {}), ...(note ? { note } : {}) };
}

/**
 * A generation request with the imagery style applied, and the sentence that
 * says so; unchanged (and nothing to say) for an intent it doesn't apply to.
 */
export function withImageryStyle<
  R extends { intent: string; prompt: string; reference?: string[] | undefined },
>(req: R, style: ImageryStyle | null): { req: R; said?: string } {
  if (!style || !STYLED_INTENTS.has(req.intent)) return { req };
  const references = req.reference ?? [];
  const sendImage =
    style.image !== undefined &&
    !references.includes(style.image) &&
    references.length < MAX_REFERENCES;
  const next: R = {
    ...req,
    prompt: style.note ? `${req.prompt.trim()} Imagery style: ${style.note}` : req.prompt,
    ...(sendImage ? { reference: [...references, style.image as string] } : {}),
  };
  const parts = [
    sendImage ? `its imagery image (${style.image}) went as a style reference` : "",
    style.note ? "its imagery note was added to the prompt" : "",
  ].filter(Boolean);
  return {
    req: next,
    said: `Drawn in the Look "${style.look}": ${parts.join(" and ")}.`,
  };
}
