/**
 * What the lookbook stage says to the agent. Each one names the operation to
 * reach for, because the agent reads it cold: it may be a new session that has
 * never seen a lookbook.
 */

const GUIDE = "(get_lookbook says what comes next; the guide is velloo://guide/lookbook)";

export const START_FROM_APP = `Start a Velloo lookbook for this app ${GUIDE}. Read the page I want to redesign from the codebase and write the brief with its real copy, top to bottom (update_lookbook { brief }); ask me which page if it isn't clear. Then propose three directions that differ from each other and from the look the app has now, and ask me to narrow them on the canvas.`;

export const START_FROM_SCRATCH = `Start a Velloo lookbook for something new ${GUIDE}. Ask me what I'm building, who it's for and what the first page has to say, a few questions at a time, until you can write the brief (update_lookbook { brief }). Then propose three directions that differ from each other, and ask me to narrow them on the canvas.`;

export const proposeMore = (count: number, note: string) =>
  `Propose ${count} more lookbook direction${count === 1 ? "" : "s"}${note.trim() ? `: ${note.trim()}` : ""}. Keep each one different from the directions already there, and write it so an image model can draw it: palette with hex values, type, texture, imagery, motifs, and how the page is laid out (update_lookbook { directions }).`;

export const reviseDirection = (title: string, id: string, ask: string) =>
  `Change the lookbook direction "${title}" (id ${id}): ${ask.trim()} Rewrite its description and layout to match (update_lookbook { directions: [{ id: "${id}", … }] }); don't draw new images unless I ask.`;

export const buildFromMock = (title: string, mock: string) =>
  `Build the design from the lookbook mock I chose: ${mock} (direction "${title}"). Open the image and look at it closely, then compose it as a screen on the canvas with this app's own components, following the design's rules and theme (set the theme to the mock's palette and type first if it differs). The mock's layout, type and colour are the target; its facts are not: use the brief's real copy, and list anything in the mock the brief doesn't have as sample data. Screenshot the screen beside the mock and fix the differences before you call it done. Then clear the request (update_lookbook { resolveRequests: "all" }).`;
