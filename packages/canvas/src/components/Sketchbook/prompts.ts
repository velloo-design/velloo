/**
 * What the sketchbook says to the agent: one line each, in the person's
 * words. The sketchbook card sent with every one carries the rest (where
 * they are, the page they picked, what to read), and `get_sketchbook` and
 * velloo://guide/sketchbook carry the how.
 */

export const START_FROM_APP = "Start a Velloo sketchbook for this app.";

const START_FROM_SCRATCH = "Start a Velloo sketchbook for something new.";

/** "Explore palettes and type": a sketchbook whose subject is a Look, not a page. */
const START_LOOK_FROM_APP = "Start a Velloo sketchbook exploring palettes and type for this app.";

const START_LOOK_FROM_SCRATCH =
  "Start a Velloo sketchbook exploring palettes and type for something new.";

/** The first message of a sketchbook started on the canvas: its start line, then the goal as typed. */
export function startPrompt(
  subject: "page" | "look",
  origin: "existing" | "new",
  goal: string,
): string {
  const start =
    subject === "look"
      ? origin === "existing"
        ? START_LOOK_FROM_APP
        : START_LOOK_FROM_SCRATCH
      : origin === "existing"
        ? START_FROM_APP
        : START_FROM_SCRATCH;
  const said = goal.trim();
  return said ? `${start} What I want: ${said}` : start;
}

export const proposeMore = (count: number, note: string) =>
  `Propose ${count} more direction${count === 1 ? "" : "s"}${note.trim() ? `: ${note.trim()}` : "."}`;

export const reviseDirection = (title: string, ask: string) =>
  `Change the direction "${title}": ${ask.trim()}`;

/** The build ask: "Design 2 screens each from "Park poster" and "Swiss ledger"." */
export const designFromDirections = (titles: string[], count: number, instructions: string) => {
  const quoted = titles.map((t) => `"${t}"`);
  const names =
    quoted.length <= 2
      ? quoted.join(" and ")
      : `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}`;
  const what =
    count === 1
      ? `a screen from ${titles.length === 1 ? "the direction" : "each of"} ${names}`
      : `${count} screens from ${titles.length === 1 ? "the direction" : "each of"} ${names}, each a different take`;
  return `Design ${what}.${instructions.trim() ? ` ${instructions.trim()}` : ""}`;
};

/** "Make this a Look", with an agent to finish it: the tokens and words come from the images. */
export const finishLook = (title: string, look: string) =>
  `I made "${title}" a theme look ("${look}"). Set its colours, type and corners from its images, and write its rules and imagery note.`;
