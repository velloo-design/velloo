import type { ActivityEntry } from "./store/activity.ts";
import { useCanvas } from "./store.ts";
import { pushToast, toastError } from "./toast.ts";

const TOAST_ID = "art-direction-changed";

/**
 * Say so when an agent writes the art direction while the person is elsewhere on
 * the canvas, and offer to open it: the agent proposes directions and draws
 * images, and the person is the one who narrows them. One toast however many
 * writes follow; none while the art direction is open, where they show as they land.
 */
export function announceArtDirectionChange(entry: ActivityEntry): void {
  if (entry.source !== "mcp") return;
  if (entry.verb !== "update_art_direction" && entry.verb !== "generate_art_direction") return;
  if (useCanvas.getState().view === "art-direction") return;
  pushToast({
    id: TOAST_ID,
    title:
      entry.verb === "generate_art_direction"
        ? "New images in the art direction"
        : "Your agent updated the art direction",
    message: "Drop, pick and regenerate on the canvas.",
    ttl: Number.POSITIVE_INFINITY,
    closeButton: true,
    action: {
      label: "Open",
      onClick: () =>
        void useCanvas
          .getState()
          .openArtDirection()
          .catch((err) => toastError(err, "Could not open the art direction")),
    },
  });
}
