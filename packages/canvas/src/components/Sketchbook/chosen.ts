import { kindLabel } from "@velloo/protocol";
import { findSketchbookImage, type SketchbookFile } from "@velloo/schema";

/** The kind of a chosen image; a mock when it can't be found. */
const chosenKind = (sketchbook: SketchbookFile, c: { image: string }): string =>
  findSketchbookImage(sketchbook, c.image)?.image.kind ?? "mock";

/** Whether a chosen image is one of its direction's mood boards. */
export const isBoard = (sketchbook: SketchbookFile, c: { direction: string; image: string }) =>
  chosenKind(sketchbook, c) === "moodboard";

/** How a kind reads in a sentence, one and many: "mock", "mobile mocks". */
const noun = (kind: string, n: number) => {
  const one = kind === "mock" ? "mock" : kindLabel(kind).toLowerCase();
  return n === 1 ? `the ${one}` : `${n} ${one}s`;
};

/** What is chosen, in words: "the mood board", "2 mocks", "the mood board and 2 mocks". */
export function chosenWords(sketchbook: SketchbookFile): string {
  const counts = new Map<string, number>();
  for (const c of sketchbook.chosen) {
    const kind = chosenKind(sketchbook, c);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const parts = [...counts]
    .sort(([a], [b]) => (a === "moodboard" ? -1 : b === "moodboard" ? 1 : 0))
    .map(([kind, n]) => noun(kind, n));
  return parts.length <= 2
    ? parts.join(" and ")
    : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}
