/**
 * What the art direction stage says to the agent. Each one names the operation to
 * reach for, because the agent reads it cold: it may be a new session that has
 * never seen an art direction.
 */

const GUIDE = "(get_art_direction says what comes next; the guide is velloo://guide/art-direction)";

export const START_FROM_APP = `Start Velloo art direction for this app ${GUIDE}. Read the page I want to redesign from the codebase and write the brief with its real copy, top to bottom (update_art_direction { brief }); ask me which page if it isn't clear. Then propose three directions that differ from each other and from the look the app has now, and ask me to narrow them on the canvas.`;

export const START_FROM_SCRATCH = `Start Velloo art direction for something new ${GUIDE}. Ask me what I'm building, who it's for and what the first page has to say, a few questions at a time, until you can write the brief (update_art_direction { brief }). Then propose three directions that differ from each other, and ask me to narrow them on the canvas.`;

export const proposeMore = (count: number, note: string) =>
  `Propose ${count} more direction${count === 1 ? "" : "s"}${note.trim() ? `: ${note.trim()}` : ""}. Keep each one different from the directions already there, and write it so an image model can draw it: palette with hex values, type, texture, imagery, motifs, and how the page is laid out (update_art_direction { directions }).`;

export const reviseDirection = (title: string, id: string, ask: string) =>
  `Change the direction "${title}" (id ${id}): ${ask.trim()} Rewrite its description and layout to match (update_art_direction { directions: [{ id: "${id}", … }] }); don't draw new images unless I ask.`;

export const buildFromMock = (title: string, mock: string, images: boolean) =>
  `Build the design from the mock I chose in the art direction: ${mock} (direction "${title}"). Open the image and look at it closely, then compose it as a screen on the canvas with this app's own components, following the design's rules and theme (set the theme to the mock's palette and type first if it differs). The mock's layout, type and colour are the target; its facts are not: use the brief's real copy, and list anything in the mock the brief doesn't have as sample data. Screenshot the screen beside the mock and fix the differences before you call it done. ${
    images
      ? "Draw the photographs and illustrations the mock shows with generate_asset (I've allowed it: it costs credits), and tell me what they cost."
      : "Don't generate images: draw simple art yourself with upload_asset, or leave clear placeholders for my own."
  }`;
