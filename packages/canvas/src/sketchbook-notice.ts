import type { ActivityEntry } from "./store/activity.ts";
import { useCanvas } from "./store.ts";
import { pushToast, toastError } from "./toast.ts";

const TOAST_ID = "sketchbook-changed";

/**
 * Say so when an agent writes the sketchbook while the person is elsewhere on
 * the canvas, and offer to open it: the agent proposes directions and draws
 * images, and the person is the one who narrows them. One toast however many
 * writes follow; none while the sketchbook is open, where they show as they land.
 */
export function announceSketchbookChange(entry: ActivityEntry): void {
  if (entry.source !== "mcp") return;
  if (entry.verb !== "update_sketchbook" && entry.verb !== "generate_sketchbook") return;
  if (useCanvas.getState().view === "sketchbook") return;
  pushToast({
    id: TOAST_ID,
    title:
      entry.verb === "generate_sketchbook"
        ? "New images in the sketchbook"
        : "Your agent updated the sketchbook",
    message: "Drop, pick and regenerate on the canvas.",
    ttl: Number.POSITIVE_INFINITY,
    closeButton: true,
    action: {
      label: "Open",
      onClick: () =>
        void useCanvas
          .getState()
          .openSketchbook()
          .catch((err) => toastError(err, "Could not open the sketchbook")),
    },
  });
}
