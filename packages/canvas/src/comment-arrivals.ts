import type { CommentArrival } from "./api.ts";
import { useCanvas } from "./store.ts";
import { pushToast } from "./toast.ts";

/**
 * New reviewer comments from the cloud sync, offered to the agent. The offer
 * is a notification that never takes focus; its action only puts the comments
 * in the composer as cards — nothing reaches the agent until the person sends.
 */

function boardNameFor(boardId: string): string {
  const state = useCanvas.getState();
  return (
    state.boards[boardId]?.name ??
    state.design?.boards.find((b) => b.id === boardId)?.name ??
    boardId
  );
}

export function arrivalTitle(arrival: CommentArrival): string {
  const n = arrival.messageIds.length;
  return `${n} new ${n === 1 ? "comment" : "comments"} on ${boardNameFor(arrival.boardId)}`;
}

/** Put these comments in the composer and stop offering them. */
export async function handArrivalsToAgent(arrivals: CommentArrival[]): Promise<void> {
  const state = useCanvas.getState();
  // One card per new message; each thread keeps only the messages it holds.
  const messageIds = arrivals.flatMap((a) => a.messageIds);
  await state.addCommentsToAgent(
    [...new Set(arrivals.flatMap((a) => a.threadIds))].map((threadId) => ({
      threadId,
      messageIds,
    })),
  );
  await state.acknowledgeCommentArrivals(arrivals.flatMap((a) => a.messageIds));
}

/** The toast for one arrival. Letting it time out keeps the offer in the Agent tab. */
export function announceCommentArrival(arrival: CommentArrival): void {
  pushToast({
    kind: "info",
    title: arrivalTitle(arrival),
    message: "From the shared link. Hand them to the agent when you're ready.",
    ttl: 10_000,
    action: { label: "Add to agent", onClick: () => void handArrivalsToAgent([arrival]) },
  });
}
