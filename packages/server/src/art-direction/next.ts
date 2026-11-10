import type { ArtDirectionState } from "@velloo/protocol";
import { type ArtDirectionFile, activeDirections } from "@velloo/schema";

/** What writing the brief takes, for the start the person picked on the canvas. */
export function briefStep(artDirection: ArtDirectionFile): string {
  const write =
    "then write the brief (update_art_direction { brief }) and propose three directions (update_art_direction { directions }) that differ from each other and from what the app looks like now; the guide is velloo://guide/art-direction.";
  if (artDirection.origin === "new") {
    return `The person is starting something new: ask what it is, who it's for and what the first page must say, a few questions at a time; ${write}`;
  }
  const page = artDirection.page;
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

/** What the agent should do next, from where the art direction stands. */
export function nextStep(state: ArtDirectionState, canvasUrl?: string): string {
  const { artDirection } = state;
  const at = canvasUrl ? ` (${canvasUrl}/?view=art-direction&ad=${state.id})` : "";
  if (!artDirection.brief) return briefStep(artDirection);
  const active = activeDirections(artDirection);
  switch (artDirection.stage) {
    case "brief":
    case "directions":
      return active.length === 0
        ? "Propose three directions that differ from each other and from what the app has (update_art_direction { directions }), then ask the person to narrow them on the canvas."
        : `Ask the person to drop or edit directions on the canvas${at}, then draw a mood board per direction (generate_art_direction { kind: "moodboard" }), unless they skip mood boards.`;
    case "boards":
      return `Ask the person to pick mood boards and a mock count on the canvas${at}, then draw the mocks (generate_art_direction { kind: "mock" }).`;
    case "mocks":
      return `Ask the person to choose the mocks to build on the canvas${at}; each becomes a screen you build.`;
    case "build":
      return buildStep(artDirection);
  }
}

/** The build, said whole: every chosen mock, the board, what the person added. */
export function buildStep(artDirection: ArtDirectionFile): string {
  const mocks = artDirection.chosen.map((c) => c.mock);
  return [
    mocks.length === 1
      ? `Build the chosen mock (${mocks[0]}) as a screen:`
      : `Build each chosen mock as its own screen (${mocks.join(", ")}):`,
    "open the image and look at it closely, set the theme to its palette and type if they differ, then compose it from the app's own components and the design's rules. Its layout, type and colour are the target; its facts are not: use the brief's real copy and list anything else as sample data. Screenshot each screen beside its mock and fix the biggest differences.",
    artDirection.buildBoard
      ? `Put the screens on board ${artDirection.buildBoard} (compose with \`boardId: "${artDirection.buildBoard}"\`): the person is watching it.`
      : "",
    artDirection.buildNotes ? `The person added: "${artDirection.buildNotes}"` : "",
    artDirection.generateImages === true
      ? "They allowed paid images: draw the photographs and illustrations the mocks show with generate_asset, and relay the cost."
      : artDirection.generateImages === false
        ? "They declined paid images: author simple art with upload_asset or leave clear placeholders."
        : "Ask before drawing any image with generate_asset: it costs credits.",
  ]
    .filter(Boolean)
    .join(" ");
}
