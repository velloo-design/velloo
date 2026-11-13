import type { SketchbookBrief, SketchbookDirection } from "@velloo/schema";

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
 * - Given a mood board, the mock prompt names it as the sketchbook and drops
 *   the direction's words: the board is a better control than the words.
 * - A revision sends the mock itself and says what to change and that the rest
 *   stays; the copy goes again, or the redraw respells it.
 *
 * The other kinds hold to the same: each names what is on the sheet tile by
 * tile, every one is "flat and straight-on", and the ones that show the page
 * (a palette study, a type poster, a mobile mock, a close-up) carry its real
 * copy. A kind drawn from a mood board names it, as a mock does.
 */

const BOARD_TILES =
  "Include a type specimen tile, a colour swatch strip with the palette, two texture or photography tiles, and two small UI fragments in this style (a button and a card). Professional, considered, award-level sketchbook. No device mockups, no lorem ipsum.";

const MOCK_FRAME =
  "shown flat and straight-on as one tall screenshot of the whole page from top to bottom, no browser chrome, no device, no perspective.";

const MOBILE_FRAME =
  "shown flat and straight-on as one tall phone screenshot of the whole page from top to bottom, no device frame, no status bar, no perspective.";

const FLAT =
  "Shown flat and straight-on on a plain background: no device, no perspective, no desk.";

const MOCK_FINISH =
  "Award-level, distinctive design with a clear hierarchy, crisp legible text and consistent spacing; not a generic template, no gradient blobs, no emoji.";

const sentence = (s: string): string => {
  const t = s.trim();
  return t === "" ? "" : /[.!?]$/.test(t) ? t : `${t}.`;
};

const join = (parts: string[]) => parts.filter(Boolean).join(" ");

/** The look, either from the attached mood board or in the direction's words. */
const look = (d: SketchbookDirection, fromBoard: boolean): string =>
  fromBoard
    ? "in the look of the attached mood board (its palette, type, textures and motifs)."
    : `in this look: ${d.title}, ${sentence(d.description)}`;

const copy = (
  brief: SketchbookBrief,
  verb = "Use exactly this copy, spelled correctly, top to bottom",
) => (brief.content.trim() ? `${verb}:\n${brief.content.trim()}` : "");

const notes = (brief: SketchbookBrief) => (brief.notes ? sentence(brief.notes) : "");

function boardPrompt(brief: SketchbookBrief, d: SketchbookDirection): string {
  return join([
    `A brand designer's mood board for ${sentence(brief.product)}`,
    `Direction: ${d.title}. A tidy grid collage of tiles pinned on a neutral wall: ${sentence(d.description)}`,
    BOARD_TILES,
    notes(brief),
  ]);
}

/** A full page, desktop or mobile. */
function pagePrompt(
  brief: SketchbookBrief,
  d: SketchbookDirection,
  opts: { fromBoard: boolean; mobile: boolean },
): string {
  const frame = opts.mobile ? MOBILE_FRAME : MOCK_FRAME;
  const subject = `a full-length ${opts.mobile ? "mobile" : "desktop"} design of ${brief.page.trim()} for ${sentence(brief.product)}`;
  const opening = opts.fromBoard
    ? `Using the attached mood board as the sketchbook (its palette, type, textures and motifs), design ${subject.replace(/^a /, "")} Show it ${frame}`
    : `${subject.charAt(0).toUpperCase()}${subject.slice(1)} Show it ${frame} Sketchbook: ${d.title}, ${sentence(d.description)}`;
  const layout = d.layout
    ? `Layout: ${sentence(d.layout)}${opts.mobile ? " Adapted to one narrow column." : ""}`
    : "";
  return join([opening, layout, copy(brief), MOCK_FINISH, notes(brief)]);
}

/** What to draw and how, for each kind other than the mood board. */
interface KindOptions {
  fromBoard: boolean;
  /** For a close-up, what it shows. */
  focus?: string | undefined;
  /** A Look sketchbook has no page: its palette and type are drawn on a stand-in layout. */
  subject?: "page" | "look" | undefined;
}

/** The stand-in a Look sketchbook's palette study is drawn on: small, generic, every role in use. */
const LOOK_LAYOUT =
  "One small generic interface (a navigation bar, a headline, a short paragraph, a primary and a secondary button, and a row of three cards with a badge each)";

const KIND_PROMPTS: Record<
  string,
  (brief: SketchbookBrief, d: SketchbookDirection, opts: KindOptions) => string
> = {
  mock: (brief, d, opts) => pagePrompt(brief, d, { fromBoard: opts.fromBoard, mobile: false }),
  mobile: (brief, d, opts) => pagePrompt(brief, d, { fromBoard: opts.fromBoard, mobile: true }),
  palette: (brief, d, opts) =>
    opts.subject === "look"
      ? join([
          `A colour study for ${sentence(brief.product)}`,
          `${LOOK_LAYOUT} drawn four times side by side, each in a different colour scheme ${look(d, opts.fromBoard)}`,
          "Light and dark schemes both. Under each, a small label with the scheme's name and its colours as hex values (background, text, primary, accent, muted, border).",
          FLAT,
          "Short plausible words for this product, crisp and legible, no lorem ipsum.",
          notes(brief),
        ])
      : join([
          `A colour study for ${brief.page.trim()} of ${sentence(brief.product)}`,
          `One simple layout of the page (its navigation, its headline and one row of content) drawn four times side by side, each in a different colour scheme ${look(d, opts.fromBoard)}`,
          "Under each, a small label with the scheme's name and its colours as hex values.",
          FLAT,
          copy(brief, "Take the navigation and headline from this copy, spelled correctly"),
          "Crisp legible text, no lorem ipsum.",
        ]),
  typeposter: (brief, d, opts) =>
    join([
      `A typographic poster for ${sentence(brief.product)}`,
      `The display and body type pairing ${look(d, opts.fromBoard)}`,
      opts.subject === "look"
        ? "A short headline for this product set large in the display face, and a paragraph in the body face, then a ladder of the type styles, each labelled with its name (Display, Heading, Body, Caption), its typeface and its size. Both faces are Google Fonts, named exactly. Generous margins, a strict grid."
        : "The page's real headline set large in the display face, and one of its paragraphs in the body face, then a ladder of the type styles, each labelled with its name (Display, Heading, Body, Caption), its typeface and its size. Generous margins, a strict grid.",
      FLAT,
      opts.subject === "look"
        ? notes(brief)
        : copy(brief, "The headline and paragraph come from this copy, spelled correctly"),
    ]),
  uikit: (brief, d, opts) =>
    join([
      `A UI kit sheet for ${sentence(brief.product)}`,
      `Its components ${look(d, opts.fromBoard)}`,
      "Laid out on one sheet in labelled groups: buttons (primary, secondary, ghost) in default, hover, pressed and disabled states; text inputs (empty, filled, focused, error); a content card; a top navigation bar; badges. Consistent spacing, crisp legible labels in the product's own words, no lorem ipsum.",
      FLAT,
    ]),
  imagery: (brief, d, opts) =>
    join([
      `An imagery study for ${sentence(brief.product)}`,
      `A tidy grid of five photographs or illustrations, the subjects its pages would show, all in one consistent treatment (colour grade, light, crop, texture or illustration style) ${look(d, opts.fromBoard)}`,
      "No interface, no text, no logos.",
      FLAT,
      notes(brief),
    ]),
  icons: (brief, d, opts) =>
    join([
      `An icon and motif sheet for ${sentence(brief.product)}`,
      `A 4×4 grid of sixteen interface icons this product needs, one stroke weight, one corner style, on one grid, and below them two or three recurring decorative motifs (a pattern, a shape, an ornament), ${look(d, opts.fromBoard)}`,
      "Evenly spaced on a plain background, no labels.",
      FLAT,
    ]),
  detail: (brief, d, opts) =>
    join([
      `A close-up of ${opts.focus?.trim() || "the hero section"} of ${brief.page.trim()} for ${sentence(brief.product)}`,
      `Cropped to that one section at full size, so its type, spacing, borders and states are crisp, ${look(d, opts.fromBoard)}`,
      "Shown flat and straight-on, no browser chrome, no device, no perspective.",
      copy(brief, "Use this copy where it appears, spelled correctly"),
      MOCK_FINISH,
    ]),
};

/** The kinds Velloo has a prompt for; the cloud's list is cut to these. */
export const PROMPTED_KINDS: readonly string[] = ["moodboard", ...Object.keys(KIND_PROMPTS)];

/** The prompt for one image of `kind`; undefined for a kind with no template. */
export function kindPrompt(
  kind: string,
  brief: SketchbookBrief,
  d: SketchbookDirection,
  opts: KindOptions,
): string | undefined {
  if (kind === "moodboard") return boardPrompt(brief, d);
  return KIND_PROMPTS[kind]?.(brief, d, opts);
}

const REVISED: Record<string, { what: string; frame: string }> = {
  mock: { what: "full-length desktop design", frame: MOCK_FRAME },
  mobile: { what: "full-length mobile design", frame: MOBILE_FRAME },
  detail: {
    what: "close-up of a section",
    frame: "flat and straight-on, cropped as it is, no browser chrome, no device, no perspective.",
  },
};

export function revisePrompt(brief: SketchbookBrief, instruction: string, kind = "mock"): string {
  const { what, frame } = REVISED[kind] ?? (REVISED.mock as { what: string; frame: string });
  return join([
    `Revise the attached ${what} of ${brief.page.trim()} for ${sentence(brief.product)}`,
    `Change: ${sentence(instruction)}`,
    "Keep everything else about it (its sketchbook, palette, type, imagery and the order of its sections) unless the change asks otherwise.",
    `Show it ${frame}`,
    copy(brief, "Keep exactly this copy, spelled correctly, top to bottom"),
    MOCK_FINISH,
  ]);
}

/** The cloud's limit for a sketchbook image's prompt. */
export const MAX_IMAGE_PROMPT = 6000;
