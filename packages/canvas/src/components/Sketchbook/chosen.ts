import type { SketchbookFile } from "@velloo/schema";

/** Whether a chosen image is one of its direction's mood boards (else it is a mock). */
export const isBoard = (sketchbook: SketchbookFile, c: { direction: string; image: string }) =>
  sketchbook.directions.find((d) => d.id === c.direction)?.boards.some((b) => b.path === c.image) ??
  false;

const count = (n: number, one: string, many: string) =>
  n === 0 ? "" : n === 1 ? `the ${one}` : `${n} ${many}`;

/** What is chosen, in words: "the mood board", "2 mocks", "the mood board and 2 mocks". */
export function chosenWords(sketchbook: SketchbookFile): string {
  const boards = sketchbook.chosen.filter((c) => isBoard(sketchbook, c)).length;
  const mocks = sketchbook.chosen.length - boards;
  return [count(boards, "mood board", "mood boards"), count(mocks, "mock", "mocks")]
    .filter(Boolean)
    .join(" and ");
}
