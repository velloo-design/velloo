import type { BoardInspiration, ScreenInspiration, SketchbookLinks } from "@velloo/protocol";
import {
  currentBoard,
  type SketchbookDirection,
  type SketchbookFile,
  type SketchbookOutput,
  sketchbookName,
} from "@velloo/schema";
import type { DesignFolder } from "../design-folder.ts";

/**
 * The links between sketchbooks and what they made. The sketchbook's
 * `outputs` are the one record: a screen's `inspiredBy` and a board's chip are
 * read from them here, so nothing on a screen or a board has to be kept in step.
 */

/** Board chips show a few images, not every one a busy board came from. */
const MAX_CHIP_IMAGES = 4;

/** Whether `mock` is a revision of `of`, at any distance. */
function revises(direction: SketchbookDirection, mock: string, of: string): boolean {
  const seen = new Set<string>();
  let at = direction.mocks.find((m) => m.path === mock)?.revisedFrom;
  while (at && !seen.has(at)) {
    if (at === of) return true;
    seen.add(at);
    at = direction.mocks.find((m) => m.path === at)?.revisedFrom;
  }
  return false;
}

/**
 * Whether the screen an output records is behind its direction: an image of
 * the kind it was built from was drawn after it was built — a new mood board
 * for one built from a mood board; for one built from a mock, a fresh mock or
 * a revision of that mock. A revision of another mock is that mock's business.
 * `newer` is the newest such image, the one to rebuild from.
 */
export function outputStatus(
  sketchbook: SketchbookFile,
  output: Pick<SketchbookOutput, "direction" | "image" | "at">,
): { stale: boolean; newer?: string } {
  const d = sketchbook.directions.find((x) => x.id === output.direction);
  if (!d) return { stale: false };
  const later = d.boards.some((b) => b.path === output.image)
    ? d.boards.filter((b) => b.createdAt > output.at)
    : d.mocks.some((m) => m.path === output.image)
      ? d.mocks.filter(
          (m) => m.createdAt > output.at && (!m.revisedFrom || revises(d, m.path, output.image)),
        )
      : [];
  const newest = later.reduce<(typeof later)[number] | undefined>(
    (a, b) => (!a || b.createdAt >= a.createdAt ? b : a),
    undefined,
  );
  return newest ? { stale: true, newer: newest.path } : { stale: false };
}

type Book = { id: string; sketchbook: SketchbookFile };

function inspiration(book: Book, output: SketchbookOutput): ScreenInspiration {
  const d = book.sketchbook.directions.find((x) => x.id === output.direction);
  return {
    ...output,
    sketchbook: book.id,
    name: sketchbookName(book.sketchbook),
    directionTitle: d?.title ?? output.direction,
    ...outputStatus(book.sketchbook, output),
  };
}

/**
 * Each screen's inspiration, from the outputs of every sketchbook. A screen
 * built again from another sketchbook is that one's; a deleted screen has none.
 */
export function screenInspirations(
  books: Book[],
  folder: Pick<DesignFolder, "screens">,
): Map<string, ScreenInspiration> {
  const out = new Map<string, ScreenInspiration>();
  for (const book of books) {
    for (const output of book.sketchbook.outputs) {
      if (!folder.screens.has(output.screen)) continue;
      const held = out.get(output.screen);
      if (!held || output.at > held.at) out.set(output.screen, inspiration(book, output));
    }
  }
  return out;
}

/**
 * Everything the canvas shows of the links: each screen's inspiration, each
 * board's sketchbooks — through the screens on it, its Look's origin, or
 * being the board a sketchbook builds on — and which boards' Looks can restyle.
 */
export function sketchbookLinks(
  books: Book[],
  folder: Pick<DesignFolder, "screens" | "boards" | "looks">,
): SketchbookLinks {
  const screens = screenInspirations(books, folder);
  const byId = new Map(books.map((b) => [b.id, b]));
  const boards: Record<string, BoardInspiration[]> = {};
  const looks: Record<string, string> = {};
  for (const board of folder.boards.values()) {
    if (board.archivedAt) continue;
    const found = new Map<string, BoardInspiration>();
    const add = (id: string, direction: string | undefined, images: string[]) => {
      const book = byId.get(id);
      if (!book) return;
      const entry = found.get(id) ?? {
        sketchbook: id,
        name: sketchbookName(book.sketchbook),
        images: [],
      };
      if (!entry.direction && direction) entry.direction = direction;
      for (const image of images) {
        if (!entry.images.includes(image) && entry.images.length < MAX_CHIP_IMAGES) {
          entry.images.push(image);
        }
      }
      found.set(id, entry);
    };
    for (const frame of board.frames) {
      const from = screens.get(frame.screen);
      if (from) add(from.sketchbook, from.direction, [from.image]);
    }
    for (const book of books) {
      if (book.sketchbook.buildBoard !== board.id) continue;
      const first = book.sketchbook.chosen[0];
      add(
        book.id,
        first?.direction,
        book.sketchbook.chosen.map((c) => c.image),
      );
    }
    const lookName = board.theme ?? "default";
    const look = folder.looks.get(lookName);
    if (look) {
      looks[board.id] = lookName;
      if (look.origin) {
        const book = byId.get(look.origin.sketchbook);
        const d = book?.sketchbook.directions.find((x) => x.id === look.origin?.direction);
        const cover = d ? currentBoard(d) : undefined;
        add(look.origin.sketchbook, look.origin.direction, [
          ...(cover ? [cover.path] : []),
          ...look.images.slice(0, 1).map((i) => i.path),
        ]);
      }
    }
    if (found.size > 0) boards[board.id] = [...found.values()];
  }
  return { screens: Object.fromEntries(screens), boards, looks };
}
