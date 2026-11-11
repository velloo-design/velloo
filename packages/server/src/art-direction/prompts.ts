import type { ArtDirectionBrief, ArtDirectionDirection } from "@velloo/schema";

/**
 * The words sent to the image models. Generalized from the prompts the
 * 2026-11 model comparison ran (velloo-modeleval `inspiration/`), which is
 * where each sentence earned its place:
 *
 * - A mood board is a "tidy grid collage of tiles pinned on a neutral wall"
 *   with a type specimen, a swatch strip, textures and two UI fragments.
 *   Without the tile list, models draw one illustration instead of a board.
 * - A mock is "flat and straight-on as one tall screenshot of the whole page",
 *   or models add a laptop, a perspective and a desk.
 * - A mock carries the page's real copy, top to bottom, "spelled correctly".
 *   Without it every model invents a different product.
 * - Given a mood board, the mock prompt names it as the art direction and drops
 *   the direction's words: the board is a better control than the words.
 */

const BOARD_TILES =
  "Include a type specimen tile, a colour swatch strip with the palette, two texture or photography tiles, and two small UI fragments in this style (a button and a card). Professional, considered, award-level art direction. No device mockups, no lorem ipsum.";

const MOCK_FRAME =
  "shown flat and straight-on as one tall screenshot of the whole page from top to bottom, no browser chrome, no device, no perspective.";

const MOCK_FINISH =
  "Award-level, distinctive design with a clear hierarchy, crisp legible text and consistent spacing; not a generic template, no gradient blobs, no emoji.";

const sentence = (s: string): string => {
  const t = s.trim();
  return t === "" ? "" : /[.!?]$/.test(t) ? t : `${t}.`;
};

export function boardPrompt(brief: ArtDirectionBrief, d: ArtDirectionDirection): string {
  return [
    `A brand designer's mood board for ${sentence(brief.product)}`,
    `Direction: ${d.title}. A tidy grid collage of tiles pinned on a neutral wall: ${sentence(d.description)}`,
    BOARD_TILES,
    brief.notes ? sentence(brief.notes) : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function mockPrompt(
  brief: ArtDirectionBrief,
  d: ArtDirectionDirection,
  opts: { fromBoard: boolean },
): string {
  const subject = `a full-length desktop design of ${brief.page.trim()} for ${sentence(brief.product)}`;
  const opening = opts.fromBoard
    ? `Using the attached mood board as the art direction (its palette, type, textures and motifs), design ${subject.replace(/^a /, "")} Show it ${MOCK_FRAME}`
    : `${subject.charAt(0).toUpperCase()}${subject.slice(1)} Show it ${MOCK_FRAME} Art direction: ${d.title}, ${sentence(d.description)}`;
  const content = brief.content.trim()
    ? `Use exactly this copy, spelled correctly, top to bottom:\n${brief.content.trim()}`
    : "";
  return [
    opening,
    d.layout ? `Layout: ${sentence(d.layout)}` : "",
    content,
    MOCK_FINISH,
    brief.notes ? sentence(brief.notes) : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** The cloud's limit for a mood board or mock prompt. */
export const MAX_IMAGE_PROMPT = 6000;
