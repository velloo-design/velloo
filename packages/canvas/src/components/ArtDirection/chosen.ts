import type { ArtDirectionFile } from "@velloo/schema";

/** Whether a chosen image is one of its direction's mood boards (else it is a mock). */
export const isBoard = (artDirection: ArtDirectionFile, c: { direction: string; image: string }) =>
  artDirection.directions
    .find((d) => d.id === c.direction)
    ?.boards.some((b) => b.path === c.image) ?? false;

const count = (n: number, one: string, many: string) =>
  n === 0 ? "" : n === 1 ? `the ${one}` : `${n} ${many}`;

/** What is chosen, in words: "the mood board", "2 mocks", "the mood board and 2 mocks". */
export function chosenWords(artDirection: ArtDirectionFile): string {
  const boards = artDirection.chosen.filter((c) => isBoard(artDirection, c)).length;
  const mocks = artDirection.chosen.length - boards;
  return [count(boards, "mood board", "mood boards"), count(mocks, "mock", "mocks")]
    .filter(Boolean)
    .join(" and ");
}
