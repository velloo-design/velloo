import type { SketchbookState } from "@velloo/protocol";
import {
  activeDirections,
  currentBoard,
  type SketchbookFile,
  type SketchbookOutput,
  sketchbookName,
} from "@velloo/schema";
import { outputStatus } from "./links.ts";

/** What writing the brief takes, for the start the person picked on the canvas. */
export function briefStep(sketchbook: SketchbookFile): string {
  const write =
    "then write the brief (update_sketchbook { brief }) and propose three directions (update_sketchbook { directions }) that differ from each other and from what the app looks like now; the guide is velloo://guide/sketchbook.";
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
  switch (sketchbook.stage) {
    case "brief":
    case "directions":
      return active.length === 0
        ? "Propose three directions that differ from each other and from what the app has (update_sketchbook { directions }), then ask the person to narrow them on the canvas."
        : `Ask the person to drop or edit directions on the canvas${at}, then draw a mood board per direction (generate_sketchbook { kind: "moodboard" }), unless they skip mood boards.`;
    case "boards":
      return `Ask the person to pick mood boards and a mock count on the canvas${at}, then draw the mocks (generate_sketchbook { kind: "mock" }); or they choose mood boards to design screens from directly.`;
    case "mocks":
      return `Ask the person to choose the mocks to design screens from on the canvas${at}, or to revise one (generate_sketchbook { kind: "mock", revise: { mock, instruction } }).`;
    case "screens": {
      const stale = sketchbook.outputs.filter((o) => outputStatus(sketchbook, o).stale);
      if (stale.length === 0) return screensStep(sketchbook);
      return `${screensStep(sketchbook)} Since then, ${stale.map((o) => `screen ${o.screen}`).join(", ")} ${stale.length === 1 ? "was" : "were"} built from an image its direction has redrawn (\`outputs[].stale\`). When the person wants ${stale.length === 1 ? "it" : "one"} rebuilt from the new image: ${recomposeStep(state.id, sketchbook, stale[0] as SketchbookOutput)}`;
    }
  }
}

/**
 * The screens, said whole: every chosen image (with its mood board, when the
 * person sends it), the board, what the person added.
 */
export function screensStep(sketchbook: SketchbookFile): string {
  const built = new Map(sketchbook.outputs.map((o) => [o.image, o.screen]));
  const lines = sketchbook.chosen.map((c) => {
    const d = sketchbook.directions.find((x) => x.id === c.direction);
    const isBoard = d?.boards.some((b) => b.path === c.image) ?? false;
    const mock = d?.mocks.find((m) => m.path === c.image);
    const board =
      sketchbook.buildWithBoards && mock && d
        ? (d.boards.find((b) => b.path === mock.fromBoard) ?? currentBoard(d))
        : undefined;
    const screen = built.get(c.image);
    return `${
      isBoard
        ? `the mood board ${c.image}`
        : `the mock ${c.image}${board ? ` (with its mood board ${board.path})` : ""}`
    }${screen ? ` (built as screen ${screen})` : ""}`;
  });
  return [
    lines.length === 1
      ? `Design a screen inspired by ${lines[0]}:`
      : `Design a screen inspired by each of these, one each: ${lines.join("; ")}.`,
    "Open each image and look at it closely. It is inspiration, not a spec: take its sketchbook (palette, type, composition, density, mood), set the theme to it if it differs, and compose the page from the app's own components and the design's rules rather than copying the picture. A mood board gives the look, not a layout: arrange the brief's page in it. Use the brief's real copy; anything the image invented is sample data, to list. Screenshot each screen and compare it with what inspired it.",
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
