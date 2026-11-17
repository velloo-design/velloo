import type { LookSummary, SketchbookPageOption } from "@velloo/protocol";
import type { SketchbookPage } from "@velloo/schema";
import { mutate } from "../../api.ts";
import { useCanvas } from "../../store.ts";
import { themeLabel } from "../theme-label.ts";

/** The three ways a screen starts on a board. */
export type ScreenStart = "blank" | "look" | "port";

const boardName = (boardId: string): string => {
  const s = useCanvas.getState();
  return (
    s.boards[boardId]?.name ?? s.design?.boards.find((b) => b.id === boardId)?.name ?? "this board"
  );
};

/**
 * Put the board on `look` and ask an agent to design a screen on it in that
 * Look. The card carries the how (read the Look, open its images, compose on
 * the board); the line is what the person asked for.
 */
export async function designInLook(boardId: string, look: string, what: string): Promise<void> {
  await mutate.updateBoard({ boardId, patch: { theme: look === "default" ? null : look } });
  const s = useCanvas.getState();
  s.focusLook(null);
  const named = themeLabel(look);
  await s.askAgentAbout(
    what.trim()
      ? `Design this screen in the “${named}” look: ${what.trim()}`
      : `Design a new screen in the “${named}” look.`,
    { kind: "look", ref: { boardId, theme: look }, label: `Design in ${named}` },
  );
}

/** Ask an agent to put a page of the app on the board. */
export async function portPage(boardId: string, page: SketchbookPage): Promise<void> {
  await useCanvas.getState().askAgentAbout(`Port ${page.label} from the app onto this board.`, {
    kind: "port",
    ref: {
      boardId,
      ...(page.route ? { route: page.route } : {}),
      ...(page.file ? { file: page.file } : {}),
      ...(page.captureId ? { captureId: page.captureId } : {}),
    },
    label: `Port · ${page.label}`,
  });
}

/** A sketchbook finding a look for the screen about to start, named by what it is or its board. */
export async function exploreLooksForNew(boardId: string, what: string): Promise<void> {
  await useCanvas.getState().exploreLooksFor({ label: what.trim() || boardName(boardId) });
}

/** The Looks to start from: those with imagery first, since a picture is what they offer over tokens. */
export function looksToStartFrom(looks: LookSummary[] | null): LookSummary[] {
  const all = looks ?? [];
  return [
    ...all.filter((l) => (l.look?.images.length ?? 0) > 0),
    ...all.filter((l) => (l.look?.images.length ?? 0) === 0),
  ];
}

/** Porting offers the app's pages: its routes and the pages captured from it, not the canvas's screens. */
export const PORTABLE: SketchbookPageOption["kind"][] = ["route", "capture"];
