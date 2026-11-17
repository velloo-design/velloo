import type { ScreenInspiration } from "@velloo/protocol";
import { useCanvas } from "../../store.ts";
import { toastError } from "../../toast.ts";

export interface SketchbookFrameActions {
  /** The sketchbook output this screen is, when it is one. */
  inspiration: ScreenInspiration | undefined;
  /** Rebuild it from its direction's newest image; only for an output. */
  onRecompose: (() => void) | undefined;
  /** Apply the board's Look to it; only on a board whose Look has more than tokens. */
  onRestyle: (() => void) | undefined;
  /** Start a sketchbook redesigning this screen. */
  onExploreLooks: () => void;
}

/**
 * What a frame's menu offers from the sketchbook: the agent work (Restyle,
 * Recompose), handed over the way the sketchbook's Build is — the sketchbook's
 * own session when it is running, else the open one, else the person picks —
 * and a new sketchbook on the screen.
 */
export function useSketchbookActions(
  boardId: string,
  frameId: string,
  screen: { id: string; name: string; route?: string | undefined } | undefined,
): SketchbookFrameActions {
  const inspiration = useCanvas((s) =>
    screen ? s.sketchbookLinks?.screens[screen.id] : undefined,
  );
  const look = useCanvas((s) => s.sketchbookLinks?.looks[boardId]);
  const ask = (text: string, kind: "restyle" | "recompose", sketchbook?: string) => {
    if (!screen) return;
    void useCanvas
      .getState()
      .askAgentAbout(text, {
        kind,
        ref: { boardId, frameId, screenId: screen.id, ...(sketchbook ? { sketchbook } : {}) },
        label: `${kind === "restyle" ? "Restyle" : "Recompose"} · ${screen.name}`,
      })
      .catch((err) => toastError(err, "Could not ask the agent"));
  };
  return {
    inspiration,
    onRecompose:
      screen && inspiration
        ? () =>
            ask(
              `Recompose “${screen.name}” from the newest image of “${inspiration.directionTitle}”.`,
              "recompose",
              inspiration.sketchbook,
            )
        : undefined,
    onRestyle:
      screen && look
        ? () => ask(`Restyle “${screen.name}” with this board's theme look.`, "restyle")
        : undefined,
    onExploreLooks: () => {
      if (!screen) return;
      void useCanvas
        .getState()
        .exploreLooksFor({
          label: screen.name,
          screenId: screen.id,
          ...(screen.route ? { route: screen.route } : {}),
        })
        .catch((err) => toastError(err, "Could not start a sketchbook"));
    },
  };
}
