import { kindLabel, SKETCHBOOK_LIMITS, type SketchbookState } from "@velloo/protocol";
import {
  activeDirections,
  latestOf,
  PAGE_IMAGE_KINDS,
  type SketchbookDirection,
  type SketchbookFile,
  type SketchbookOutput,
  type SketchbookProposal,
  screenDirections,
  sketchbookName,
} from "@velloo/schema";
import { outputStatus } from "./links.ts";

/**
 * The person's references, for an agent about to propose directions: look at
 * them first, and draw a direction from them.
 */
function fromReferences(sketchbook: SketchbookFile): string {
  const n = sketchbook.references.length;
  if (n === 0) return "";
  return ` The person added ${n === 1 ? "a reference" : `${n} references`}, screenshots of sites they like: open each one's \`file\` before proposing and read its \`note\`, what to take from it. Draw at least one direction from them, and list the ones a direction is drawn from in its \`references\` (ids): they go to the image model with its images.`;
}

/** What writing the brief takes, for the start the person picked on the canvas. */
export function briefStep(sketchbook: SketchbookFile): string {
  return briefWords(sketchbook) + fromReferences(sketchbook);
}

function briefWords(sketchbook: SketchbookFile): string {
  const propose = `propose three directions that differ from each other${sketchbook.subject === "look" ? ", in palette (hex values) and type pairing (Google Fonts)" : " and from what the app looks like now"}, each with its proposal of tokens (update_sketchbook { directions }); the guide is velloo://guide/sketchbook.`;
  if (sketchbook.subject === "look") {
    const read =
      sketchbook.origin === "new"
        ? "ask what the product is, who it's for and the mood it should have, a few questions at a time"
        : "read what the product is from the codebase, and ask the person the mood they want and what to keep";
    return `This sketchbook explores a Look, with no page: ${read}; then write the brief (update_sketchbook { brief: { origin, product, notes } }, no page or copy) and ${propose}`;
  }
  // Both eval models overran these on their first brief; every image prompt carries them.
  const write = `then write the brief (update_sketchbook { brief }; \`page\` is a short name of at most ${SKETCHBOOK_LIMITS.page} characters, \`content\` the page's copy in at most ${SKETCHBOOK_LIMITS.content}: keep every heading, button and label, shorten long paragraphs) and ${propose}`;
  if (sketchbook.origin === "new") {
    return `The person is starting something new: ask what it is, who it's for and what the first page must say, a few questions at a time; ${write}`;
  }
  const page = sketchbook.page;
  if (!page) {
    return `Ask the person which page of the app to redesign (unless they said), read it from the codebase, its real copy top to bottom; ${write}`;
  }
  const where = [
    page.route ? `route ${page.route}` : "",
    page.file ? `served from ${page.file}` : "",
    page.captureId ? `captured as ${page.captureId} (get_capture)` : "",
    page.screenId ? `on the canvas as screen ${page.screenId}` : "",
  ].filter(Boolean);
  return `The person picked the page to redesign: ${page.label}${where.length ? ` (${where.join(", ")})` : ""}. Read it from the codebase, its real copy top to bottom; ${write}`;
}

/** The colour roles a proposal must set, light and dark, for its Look to hold together. */
const PROPOSAL_ROLES = ["background", "foreground", "primary", "card", "muted", "border"];

/** What a proposal leaves out of {@link PROPOSAL_ROLES}, per scheme: ["colorsDark.*", "colors.card"]. */
function proposalGaps(proposal: SketchbookProposal): string[] {
  const keys = Object.keys(proposal.tokens);
  const gaps: string[] = [];
  for (const scheme of ["colors", "colorsDark"]) {
    const missing = PROPOSAL_ROLES.filter(
      (role) => !keys.some((k) => k === `${scheme}.${role}` || k === `${scheme}.${role}.DEFAULT`),
    );
    if (missing.length === PROPOSAL_ROLES.length) gaps.push(`${scheme}.*`);
    else gaps.push(...missing.map((role) => `${scheme}.${role}`));
  }
  return gaps;
}

/**
 * What the agent should do next, from where the sketchbook stands. `underAA`
 * names the directions whose proposal has colour pairs under AA.
 */
export function nextStep(
  state: SketchbookState,
  canvasUrl?: string,
  underAA: readonly string[] = [],
): string {
  const { sketchbook } = state;
  const at = canvasUrl ? ` (${canvasUrl}/?view=sketchbook&ad=${state.id})` : "";
  if (!sketchbook.brief) return briefStep(sketchbook);
  const active = activeDirections(sketchbook);
  const asked =
    "Draw or revise images only when the person asks (generate_sketchbook); every one costs their credits.";
  switch (sketchbook.stage) {
    case "brief":
    case "directions": {
      const pick = `stop, tell the person to pick directions and the inspiration to draw for them on the canvas${at}, and wait: don't draw images or move the stage on yourself.`;
      if (active.length === 0) {
        return `Propose three directions that differ from each other (update_sketchbook { directions }), each with its proposal. ${tokensStep()}${fromReferences(sketchbook)}`;
      }
      const unproposed = active.filter((d) => !d.proposal);
      if (unproposed.length > 0) {
        return `Propose tokens for ${unproposed.map((d) => d.id).join(", ")}. ${tokensStep()} Then ${pick}`;
      }
      const partial = active.flatMap((d) => {
        const gaps = d.proposal ? proposalGaps(d.proposal) : [];
        return gaps.length > 0 ? [`${d.id} lacks ${gaps.join(", ")}`] : [];
      });
      if (partial.length > 0) {
        return `Finish the proposals: ${partial.join("; ")}. ${tokensStep()} Then ${pick}`;
      }
      const failing = active.filter((d) => underAA.includes(d.id)).map((d) => d.id);
      if (failing.length > 0) {
        return `Fix the pairs under AA in ${failing.join(", ")} (\`underAA\`) and write the proposal again. Then ${pick}`;
      }
      return `Every direction has its proposal: ${pick} Revise a direction or its proposal when they ask (update_sketchbook { directions: [{ id, … }] }).`;
    }
    case "inspiration":
      return `The person draws inspiration on the canvas${at}, then mocks or the screens. ${asked}`;
    case "mocks":
      return `The person picks the directions to design screens from on the canvas${at}, and how many screens each. ${asked}`;
    case "screens": {
      const stale = sketchbook.outputs.filter((o) => outputStatus(sketchbook, o).stale);
      if (stale.length === 0) return screensStep(sketchbook);
      return `${screensStep(sketchbook)} Since then, ${stale.map((o) => `screen ${o.screen}`).join(", ")} ${stale.length === 1 ? "was" : "were"} built before its direction drew a newer image (\`outputs[].stale\`). When the person wants ${stale.length === 1 ? "it" : "one"} rebuilt from the new image: ${recomposeStep(state.id, sketchbook, stale[0] as SketchbookOutput)}`;
    }
  }
}

/** Proposing a direction's tokens with its words. */
function tokensStep(): string {
  return [
    "A proposal is the direction's look as tokens: every semantic colour role the design uses (get_theme lists them: background, foreground, primary, secondary, accent, muted, card, popover, border, input, ring, destructive and their foregrounds), light in `colors.*` and dark in `colorsDark.*`, plus `radius.md`, and a Google Fonts pairing for the roles the theme's default typeset reads (`fontBody`, `fontHeading` in get_theme; usually `sans` and `display`).",
    "Write it with update_sketchbook { directions: [{ id, proposal: { tokens, fonts } }] }: tokens as set_theme's dotted paths, fonts as { role, family, google: true }. The result scores its contrast as score_theme_contrast does: fix every pair under AA and write it again.",
  ].join(" ");
}

/** How the steps name an image of a kind: "the mock", "the type poster". */
const noun = (kind: string) => (kind === "mock" ? "mock" : kindLabel(kind).toLowerCase());

/**
 * The screens, said whole: each direction kept for them with everything drawn
 * for it (its inspiration, the latest of each kind, and every page image), how
 * many takes on each, each direction's board, what the person added.
 */
export function screensStep(sketchbook: SketchbookFile): string {
  const directions = screenDirections(sketchbook);
  const count = sketchbook.screenCount;
  const per = (d: SketchbookDirection) => {
    const kinds = [...new Set(d.images.map((i) => i.kind))].filter(
      (k) => !PAGE_IMAGE_KINDS.includes(k),
    );
    const inspiration = kinds.flatMap((k) => {
      const latest = latestOf(d, k);
      return latest ? [`its ${noun(k)} ${latest.path}`] : [];
    });
    const pages = d.images
      .filter((i) => PAGE_IMAGE_KINDS.includes(i.kind))
      .map((i) => `the ${noun(i.kind)} ${i.path}`);
    const built = sketchbook.outputs.filter((o) => o.direction === d.id).map((o) => o.screen);
    const images = [...inspiration, ...pages];
    return `"${d.title}" (${d.id}): its description and layout, its tokens, ${images.length > 0 ? images.join(", ") : "no images (design it from its words)"}${built.length > 0 ? `; already built as ${built.map((s) => `screen ${s}`).join(", ")}` : ""}`;
  };
  const boards = directions.flatMap((d) => {
    const board = sketchbook.buildBoards[d.id];
    return board ? [`"${d.title}" on board ${board}`] : [];
  });
  const withImages = directions.some((d) => d.images.length > 0);
  const each = count === 1 ? "a screen" : `${count} screens`;
  return [
    directions.length === 1
      ? `Design ${each} from the direction ${per(directions[0] as SketchbookDirection)}, with the brief.`
      : `Design ${each} from each of these directions, with the brief: ${directions.map(per).join("; ")}.`,
    count > 1
      ? `Make the ${count} screens of a direction different takes on it: another composition, hero and rhythm each, all in its look and from the same brief, so the person has a real choice.`
      : "",
    withImages
      ? "Open each image (its `file` in get_sketchbook: these paths are the design folder's) and look at it closely. The mocks show the page in the look; the mood board and other inspiration show its system (palette, type, components, imagery): take colours, faces and details from them where they are clearer than a mock's. They are inspiration, not a spec: take their art direction (palette, type, composition, density, mood) and compose the page from the app's own components and the design's rules rather than copying a picture, coloured with the Look's tokens (`bg-accent`; in a pattern, the theme's CSS variables), never hex. Use the brief's real copy; anything an image invented is sample data, to list. Screenshot each screen and compare it with the images."
      : "",
    directions.some((d) => d.images.length === 0)
      ? "For a direction with no images, lay the brief's page out as its `layout` says, in the look its `description` gives, from the app's own components and the design's rules. Its tokens are already its board's Look: colour with the theme's classes (`bg-primary`), never hex. Use the brief's real copy, then screenshot the screen and check it against the description."
      : "",
    boards.length > 0
      ? `Put each direction's screens on its board (compose with \`boardId\`), which the person is watching: ${boards.join(", ")}. Each board is on the direction's Look, holding its proposed tokens: ${withImages ? "where the images differ, change that Look" : "to change a colour, change that Look"} (set_theme { theme }, named in get_board), never the default theme.`
      : "",
    sketchbook.subject === "look" && !sketchbook.brief?.page.trim()
      ? "The brief names no page: design the product's main page in it, unless the person said which."
      : "",
    "Record each screen as you compose it: update_sketchbook { outputs: [{ screen, direction }] }, adding `image` when it mostly follows one mock; this is how the board leads back here.",
    sketchbook.buildNotes ? `The person added: "${sketchbook.buildNotes}"` : "",
    sketchbook.generateImages === true
      ? "They allowed paid images: draw the photographs and illustrations the images show with generate_asset, and relay the cost."
      : sketchbook.generateImages === false
        ? "They declined paid images: author simple art with upload_asset or leave clear placeholders."
        : "Ask before drawing any image with generate_asset: it costs credits.",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Rebuild a screen from its direction's newest image of the kind it was built
 * from: the composition may change, the copy and node ids stay wherever the
 * same element is still there.
 */
export function recomposeStep(
  id: string,
  sketchbook: SketchbookFile,
  output: Pick<SketchbookOutput, "screen" | "direction" | "image" | "at">,
): string {
  const image = outputStatus(sketchbook, output).newer ?? output.image ?? "the direction's words";
  const title = sketchbook.directions.find((d) => d.id === output.direction)?.title;
  return [
    `Recompose screen ${output.screen} from ${image}, the newest image of ${title ? `"${title}"` : `direction ${output.direction}`} in the sketchbook "${sketchbookName(sketchbook)}" (id ${id})${image === output.image ? "" : `; it was built from ${output.image}`}.`,
    'Open the image (its `file` in get_sketchbook) and look at it closely, read the screen (get_screen { mode: "jsx" }), and rebuild it in the image\'s composition with compose { mode: "replace" }: keep its copy, and the node ids of every element that is still there. It is inspiration, not a spec, as before.',
    `Screenshot it beside the image, then record it: update_sketchbook { id: "${id}", outputs: [{ screen: "${output.screen}", image: "${image}" }] }.`,
  ].join(" ");
}

/**
 * Restyle a screen with its board's Look: what it says and how it is
 * arranged stay; only how it looks moves to the Look's tokens, rules and imagery.
 */
export function restyleStep(
  screen: { id: string; name: string },
  look: string,
  boardId: string,
): string {
  const pass = look === "default" ? "" : ` { theme: "${look}" }`;
  return [
    `Restyle screen "${screen.name}" (${screen.id}) with the Look "${look}" its board (${boardId}) uses.`,
    `Read the Look (get_theme${pass}: its tokens, images, rules and imagery note; get_board { boardId: "${boardId}" } carries the rules too) and look at its images.`,
    'Keep the screen\'s structure, its node ids and its copy exactly; change only how it looks — colours to the Look\'s tokens, type, spacing and corners to its rules, photographs and illustrations to its imagery note — with batch update_props, or get_screen { mode: "jsx" } and compose { mode: "replace" } with the same ids.',
    "Screenshot it and compare it with the Look's images.",
  ].join(" ");
}

/**
 * A new screen in a Look the person put its board on: the Look's images are
 * the picture to match and its rules the constraints, as a sketchbook's
 * chosen images are for the screens it builds.
 */
export function lookScreenStep(board: { id: string; name: string }, look: string): string {
  const pass = look === "default" ? "" : ` { theme: "${look}" }`;
  return [
    `Design a new screen on board "${board.name}" (${board.id}) in the Look "${look}", which the person just put the board on.`,
    `Read the Look first (get_theme${pass}: its tokens, images, rules and imagery note) and open its images: the screen should look like it belongs with them, and follow the Look's rules.`,
    `Compose it on a new screenId with compose { mode: "replace", boardId: "${board.id}" } so it lands on that board. If the person didn't say what the screen is, ask them in one question before composing.`,
    "Photographs and illustrations follow the imagery note; ask before drawing any with generate_asset, since it costs credits. Screenshot it and compare it with the Look's images.",
  ].join(" ");
}
