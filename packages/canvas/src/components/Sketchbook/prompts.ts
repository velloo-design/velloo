/**
 * What the sketchbook says to the agent: one line each, in the person's
 * words. The sketchbook card sent with every one carries the rest (where
 * they are, the page they picked, what to read), and `get_sketchbook` and
 * velloo://guide/sketchbook carry the how.
 */

export const START_FROM_APP = "Start a Velloo sketchbook for this app.";

export const START_FROM_SCRATCH = "Start a Velloo sketchbook for something new.";

export const proposeMore = (count: number, note: string) =>
  `Propose ${count} more sketchbook${count === 1 ? "" : "s"}${note.trim() ? `: ${note.trim()}` : "."}`;

export const reviseDirection = (title: string, ask: string) =>
  `Change the sketchbook "${title}": ${ask.trim()}`;

/** "Design screens from the mood board and 2 mocks I chose." */
export const designFromImages = (what: string, instructions: string) =>
  `Design screens from the ${what} I chose.${instructions.trim() ? ` ${instructions.trim()}` : ""}`;
