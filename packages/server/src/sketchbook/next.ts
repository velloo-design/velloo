import { kindLabel, SKETCHBOOK_LIMITS, type SketchbookState } from "@velloo/protocol";
import {
  activeDirections,
  designsScreens,
  latestOf,
  type SketchbookFile,
  type SketchbookOutput,
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
  if (sketchbook.subject === "look") {
    const read =
      sketchbook.origin === "new"
        ? "ask what the product is, who it's for and the mood it should have, a few questions at a time"
        : "read what the product is from the codebase, and ask the person the mood they want and what to keep";
    return `This sketchbook explores a Look on its own, palettes and type with no page: ${read}; then write the brief (update_sketchbook { brief: { origin, product, notes } }, no page or copy) and propose three directions (update_sketchbook { directions }) whose palettes (hex values) and type pairings (Google Fonts) differ; the guide is velloo://guide/sketchbook.`;
  }
  // Both eval models overran these on their first brief; every image prompt carries them.
  const write = `then write the brief (update_sketchbook { brief }; \`page\` is a short name of at most ${SKETCHBOOK_LIMITS.page} characters, \`content\` the page's copy in at most ${SKETCHBOOK_LIMITS.content}: keep every heading, button and label, shorten long paragraphs) and propose three directions (update_sketchbook { directions }) that differ from each other and from what the app looks like now; the guide is velloo://guide/sketchbook.`;
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

/** What the agent should do next, from where the sketchbook stands. */
export function nextStep(state: SketchbookState, canvasUrl?: string): string {
  const { sketchbook } = state;
  const at = canvasUrl ? ` (${canvasUrl}/?view=sketchbook&ad=${state.id})` : "";
  if (!sketchbook.brief) return briefStep(sketchbook);
  const active = activeDirections(sketchbook);
  if (sketchbook.subject === "look") return lookStep(sketchbook, at);
  switch (sketchbook.stage) {
    case "brief":
    case "directions":
      return active.length === 0
        ? `Propose three directions that differ from each other and from what the app has (update_sketchbook { directions }), then ask the person to narrow them on the canvas.${fromReferences(sketchbook)}`
        : `Ask the person to drop or edit directions on the canvas${at}, then draw a mood board per direction (generate_sketchbook { kind: "moodboard" }), unless they skip mood boards.`;
    case "boards":
      return `Ask the person to pick mood boards and a mock count on the canvas${at}, then draw the mocks (generate_sketchbook { kind: "mock" }); or they choose mood boards to design screens from directly. Other kinds (\`kinds\`: a palette, a type poster, …) are drawn when asked.`;
    case "mocks":
      return `Ask the person to choose the mocks to design screens from on the canvas${at}, or to revise one (generate_sketchbook { kind: "mock", revise: { image, instruction } }).`;
    case "tokens":
      return lookStep(sketchbook, at);
    case "screens": {
      const stale = sketchbook.outputs.filter((o) => outputStatus(sketchbook, o).stale);
      if (stale.length === 0) return screensStep(sketchbook);
      return `${screensStep(sketchbook)} Since then, ${stale.map((o) => `screen ${o.screen}`).join(", ")} ${stale.length === 1 ? "was" : "were"} built from an image its direction has redrawn (\`outputs[].stale\`). When the person wants ${stale.length === 1 ? "it" : "one"} rebuilt from the new image: ${recomposeStep(state.id, sketchbook, stale[0] as SketchbookOutput)}`;
    }
  }
}

/**
 * A Look sketchbook's next step: directions, then each one's mood board,
 * palette and type poster, then proposed tokens the person compares on the
 * canvas, then the Look they pick.
 */
function lookStep(sketchbook: SketchbookFile, at: string): string {
  const active = activeDirections(sketchbook);
  if (active.length === 0) {
    return `Propose three directions whose palettes and type pairings differ (update_sketchbook { directions }), then ask the person to narrow them on the canvas.${fromReferences(sketchbook)}`;
  }
  const undrawn = active.filter((d) => !latestOf(d, "palette") && !latestOf(d, "typeposter"));
  if (sketchbook.stage === "brief" || sketchbook.stage === "directions" || undrawn.length > 0) {
    return `Ask the person to drop or edit directions on the canvas${at}, and to draw each one's mood board, palette and type poster there (or draw them when asked: generate_sketchbook { kind: "moodboard" | "palette" | "typeposter" }). Then propose tokens for each.`;
  }
  const unproposed = active.filter((d) => !d.proposal);
  if (unproposed.length > 0) {
    return `${tokensStep(unproposed.map((d) => d.id))} The person compares each proposal's specimen with its images on the canvas${at}.`;
  }
  return `Every direction has proposed tokens. Ask the person to compare each specimen with its images on the canvas${at} and press Make this a Look on the one they keep; revise a proposal they ask about (update_sketchbook { directions: [{ id, proposal }] }).`;
}

/** Proposing a Look's tokens from a direction's images. */
function tokensStep(directions: string[]): string {
  return [
    `Propose tokens for ${directions.length === 1 ? `direction ${directions[0]}` : `directions ${directions.join(", ")}`}: open its palette, type poster and mood board (their \`file\`) and read the colours and faces off them.`,
    "Write every semantic colour role the design uses (get_theme lists them: background, foreground, primary, secondary, accent, muted, card, popover, border, input, ring, destructive and their foregrounds), light in `colors.*` and dark in `colorsDark.*`, plus `radius.md`, and a Google Fonts pairing: the roles the theme's default typeset reads (`fontBody`, `fontHeading` in get_theme; usually `sans` and `display`).",
    "Write it with update_sketchbook { directions: [{ id, proposal: { tokens, fonts } }] }: tokens as set_theme's dotted paths, fonts as { role, family, google: true }. The result scores its contrast as score_theme_contrast does: fix every pair under AA and write it again.",
  ].join(" ");
}

/** How the steps name an image of a kind: "the mock", "the type poster". */
const noun = (kind: string) => (kind === "mock" ? "mock" : kindLabel(kind).toLowerCase());

/**
 * The screens, said whole: every chosen image (with its mood board, when the
 * person sends it), the direction's other images that go with them (its
 * palette, type poster, …), the board, what the person added.
 */
export function screensStep(sketchbook: SketchbookFile): string {
  const built = new Map(sketchbook.outputs.map((o) => [o.image, o.screen]));
  const lines = sketchbook.chosen.map((c) => {
    const d = sketchbook.directions.find((x) => x.id === c.direction);
    const image = d?.images.find((i) => i.path === c.image);
    const kind = image?.kind ?? "mock";
    const board =
      sketchbook.buildWithBoards && image && kind !== "moodboard" && d
        ? (d.images.find((b) => b.path === image.fromBoard) ?? latestOf(d, "moodboard"))
        : undefined;
    const screen = built.get(c.image);
    return `the ${noun(kind)} ${c.image}${board ? ` (with its mood board ${board.path})` : ""}${screen ? ` (built as screen ${screen})` : ""}`;
  });
  // The kinds no screen is designed from go with every screen of their direction.
  const extras = [...new Set(sketchbook.chosen.map((c) => c.direction))].flatMap((id) => {
    const d = sketchbook.directions.find((x) => x.id === id);
    if (!d) return [];
    const kinds = [...new Set(d.images.map((i) => i.kind))].filter((k) => !designsScreens(k));
    return kinds.flatMap((k) => {
      const latest = latestOf(d, k);
      return latest ? [`its ${noun(k)} ${latest.path}`] : [];
    });
  });
  return [
    lines.length === 1
      ? `Design a screen inspired by ${lines[0]}:`
      : `Design a screen inspired by each of these, one each: ${lines.join("; ")}.`,
    extras.length > 0
      ? `Look at these too, the same direction drawn other ways: ${extras.join("; ")}. Take its colours, type, components and imagery from them where they are clearer than the page's.`
      : "",
    "Open each image and look at it closely. It is inspiration, not a spec: take its art direction (palette, type, composition, density, mood), set the theme to it if it differs, and compose the page from the app's own components and the design's rules rather than copying the picture. A mood board gives the look, not a layout: arrange the brief's page in it. Use the brief's real copy; anything the image invented is sample data, to list. Screenshot each screen and compare it with what inspired it.",
    "Record each screen as you compose it: update_sketchbook { outputs: [{ screen, image }] }, the image it was built from, which is how the board leads back here.",
    sketchbook.buildBoard
      ? `Put the screens on board ${sketchbook.buildBoard} (compose with \`boardId: "${sketchbook.buildBoard}"\`): the person is watching it.`
      : "",
    sketchbook.buildNotes ? `The person added: "${sketchbook.buildNotes}"` : "",
    sketchbook.generateImages === true
      ? "They allowed paid images: draw the photographs and illustrations the mocks show with generate_asset, and relay the cost."
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
  const image = outputStatus(sketchbook, output).newer ?? output.image;
  const title = sketchbook.directions.find((d) => d.id === output.direction)?.title;
  return [
    `Recompose screen ${output.screen} from ${image}, the newest image of ${title ? `"${title}"` : `direction ${output.direction}`} in the sketchbook "${sketchbookName(sketchbook)}" (id ${id})${image === output.image ? "" : `; it was built from ${output.image}`}.`,
    'Open the image and look at it closely, read the screen (get_screen { mode: "jsx" }), and rebuild it in the image\'s composition with compose { mode: "replace" }: keep its copy, and the node ids of every element that is still there. It is inspiration, not a spec, as before.',
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
