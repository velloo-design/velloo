/**
 * What the sketchbook says to the agent: one line each, in the person's
 * words. The sketchbook card sent with every one carries the rest (where
 * they are, the page they picked, what to read), and `get_sketchbook` and
 * velloo://guide/sketchbook carry the how.
 */

export const START_FROM_APP = "Start a Velloo sketchbook for this app.";

export const START_FROM_SCRATCH = "Start a Velloo sketchbook for something new.";

/** "Explore palettes and type": a sketchbook whose subject is a Look, not a page. */
export const START_LOOK = "Start a Velloo sketchbook exploring palettes and type.";

export const proposeTokens = (titles: string[]) =>
  `Propose tokens for ${titles.map((t) => `"${t}"`).join(", ")} from ${titles.length === 1 ? "its" : "their"} palette, type poster and mood board.`;

export const proposeMore = (count: number, note: string) =>
  `Propose ${count} more sketchbook${count === 1 ? "" : "s"}${note.trim() ? `: ${note.trim()}` : "."}`;

export const reviseDirection = (title: string, ask: string) =>
  `Change the sketchbook "${title}": ${ask.trim()}`;

/** "Design screens from the mood board and 2 mocks I chose." */
export const designFromImages = (what: string, instructions: string) =>
  `Design screens from the ${what} I chose.${instructions.trim() ? ` ${instructions.trim()}` : ""}`;

/** "Make this a Look", with an agent to finish it: the tokens and words come from the images. */
export const finishLook = (title: string, look: string) =>
  `I made "${title}" a Look ("${look}"). Set its colours, type and corners from its images, and write its rules and imagery note.`;
