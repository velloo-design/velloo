import type { SketchbookState } from "@velloo/protocol";
import { activeDirections, currentBoard, type SketchbookFile } from "@velloo/schema";

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
    case "screens":
      return screensStep(sketchbook);
  }
}

/**
 * The screens, said whole: every chosen image (with its mood board, when the
 * person sends it), the board, what the person added.
 */
export function screensStep(sketchbook: SketchbookFile): string {
  const lines = sketchbook.chosen.map((c) => {
    const d = sketchbook.directions.find((x) => x.id === c.direction);
    const isBoard = d?.boards.some((b) => b.path === c.image) ?? false;
    const mock = d?.mocks.find((m) => m.path === c.image);
    const board =
      sketchbook.buildWithBoards && mock && d
        ? (d.boards.find((b) => b.path === mock.fromBoard) ?? currentBoard(d))
        : undefined;
    return isBoard
      ? `the mood board ${c.image}`
      : `the mock ${c.image}${board ? ` (with its mood board ${board.path})` : ""}`;
  });
  return [
    lines.length === 1
      ? `Design a screen inspired by ${lines[0]}:`
      : `Design a screen inspired by each of these, one each: ${lines.join("; ")}.`,
    "Open each image and look at it closely. It is inspiration, not a spec: take its sketchbook (palette, type, composition, density, mood), set the theme to it if it differs, and compose the page from the app's own components and the design's rules rather than copying the picture. A mood board gives the look, not a layout: arrange the brief's page in it. Use the brief's real copy; anything the image invented is sample data, to list. Screenshot each screen and compare it with what inspired it.",
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
