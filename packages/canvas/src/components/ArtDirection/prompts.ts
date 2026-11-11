/**
 * What the art direction says to the agent: one line each, in the person's
 * words. The art direction card sent with every one carries the rest (where
 * they are, the page they picked, what to read), and `get_art_direction` and
 * velloo://guide/art-direction carry the how.
 */

export const START_FROM_APP = "Start Velloo art direction for this app.";

export const START_FROM_SCRATCH = "Start Velloo art direction for something new.";

export const proposeMore = (count: number, note: string) =>
  `Propose ${count} more art direction${count === 1 ? "" : "s"}${note.trim() ? `: ${note.trim()}` : "."}`;

export const reviseDirection = (title: string, ask: string) =>
  `Change the art direction "${title}": ${ask.trim()}`;

/** "Design screens from the mood board and 2 mocks I chose." */
export const designFromImages = (what: string, instructions: string) =>
  `Design screens from the ${what} I chose.${instructions.trim() ? ` ${instructions.trim()}` : ""}`;
