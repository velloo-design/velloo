import type { BoardInspiration, ScreenInspiration, SketchbookLinks } from "@velloo/protocol";
import {
  findSketchbookImage,
  latestOf,
  PAGE_IMAGE_KINDS,
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

/** Whether `image` is a revision of `of`, at any distance. */
function revises(direction: SketchbookDirection, image: string, of: string): boolean {
  const seen = new Set<string>();
  let at = direction.images.find((i) => i.path === image)?.revisedFrom;
  while (at && !seen.has(at)) {
    if (at === of) return true;
    seen.add(at);
    at = direction.images.find((i) => i.path === at)?.revisedFrom;
  }
  return false;
}

/**
 * Whether the screen an output records is behind its direction. One designed
 * from the direction as a whole is behind once it draws a mood board or a page
 * image after it was built. One that follows an image is behind once an image
 * of that kind was drawn after it — a new mood board for one built from a
 * mood board; for one built from a mock (or a mobile mock, a close-up), a
 * fresh one of that kind or a revision of that one. A revision of another
 * image is that image's business. `newer` is the newest such image, the one
 * to rebuild from.
 */
export function outputStatus(
  sketchbook: SketchbookFile,
  output: Pick<SketchbookOutput, "direction" | "image" | "at">,
): { stale: boolean; newer?: string } {
  const d = sketchbook.directions.find((x) => x.id === output.direction);
  if (!d) return { stale: false };
  const built = output.image;
  const kind = built ? d.images.find((i) => i.path === built)?.kind : undefined;
  const later = d.images.filter((i) =>
    built === undefined
      ? i.createdAt > output.at && (i.kind === "moodboard" || PAGE_IMAGE_KINDS.includes(i.kind))
      : i.kind === kind && i.createdAt > output.at && (!i.revisedFrom || revises(d, i.path, built)),
  );
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
 * being the board a sketchbook builds a direction on — and which boards'
 * Looks can restyle.
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
      const isPage = (path: string | undefined) => {
        const kind = path ? findSketchbookImage(book.sketchbook, path)?.image.kind : undefined;
        return kind !== undefined && PAGE_IMAGE_KINDS.includes(kind);
      };
      const entry: BoardInspiration = found.get(id) ?? {
        sketchbook: id,
        name: sketchbookName(book.sketchbook),
        step: isPage(images[0]) ? "mocks" : "inspiration",
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
      if (from) add(from.sketchbook, from.direction, from.image ? [from.image] : []);
    }
    for (const book of books) {
      const direction = Object.entries(book.sketchbook.buildBoards).find(
        ([, b]) => b === board.id,
      )?.[0];
      if (direction === undefined) continue;
      const d = book.sketchbook.directions.find((x) => x.id === direction);
      const cover = d ? latestOf(d, "moodboard") : undefined;
      const mocks = d?.images.filter((i) => PAGE_IMAGE_KINDS.includes(i.kind)) ?? [];
      add(book.id, direction, [...(cover ? [cover.path] : []), ...mocks.map((i) => i.path)]);
    }
    const lookName = board.theme ?? "default";
    const look = folder.looks.get(lookName);
    if (look) {
      looks[board.id] = lookName;
      if (look.origin) {
        const book = byId.get(look.origin.sketchbook);
        const d = book?.sketchbook.directions.find((x) => x.id === look.origin?.direction);
        const cover = d ? latestOf(d, "moodboard") : undefined;
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
