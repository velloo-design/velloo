import type { ActivityEntry } from "./store/activity.ts";
import { useCanvas } from "./store.ts";
import { pushToast, toastError } from "./toast.ts";

const TOAST_ID = "lookbook-changed";

/**
 * Say so when an agent writes the lookbook while the person is elsewhere on
 * the canvas, and offer to open it: the agent proposes directions and draws
 * images, and the person is the one who narrows them. One toast however many
 * writes follow; none while the lookbook is open, where they show as they land.
 */
export function announceLookbookChange(entry: ActivityEntry): void {
  if (entry.source !== "mcp") return;
  if (entry.verb !== "update_lookbook" && entry.verb !== "generate_lookbook") return;
  if (useCanvas.getState().view === "lookbook") return;
  pushToast({
    id: TOAST_ID,
    title:
      entry.verb === "generate_lookbook"
        ? "New images in the lookbook"
        : "Your agent updated the lookbook",
    message: "Drop, pick and regenerate on the canvas.",
    ttl: Number.POSITIVE_INFINITY,
    closeButton: true,
    action: {
      label: "Open",
      onClick: () =>
        void useCanvas
          .getState()
          .openLookbook()
          .catch((err) => toastError(err, "Could not open the lookbook")),
    },
  });
}
