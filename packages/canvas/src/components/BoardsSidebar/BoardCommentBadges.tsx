import { Cloud, MessageCircle } from "lucide-react";
import type { BoardCommentCounts } from "../../api.ts";
import { cn } from "../../lib/utils.ts";
import { Badge } from "../ui/badge.tsx";

/** "3 open cloud comments" — the badge's tooltip and what a screen reader hears. */
export function openCommentsLabel(count: number, scope: "local" | "shared"): string {
  const where = scope === "shared" ? "cloud" : "local";
  return `${count} open ${where} comment${count === 1 ? "" : "s"}`;
}

/**
 * The open-thread counts beside a board's name. Cloud and local are two
 * badges, not one sum: a cloud thread is a reviewer waiting on an answer, a
 * local one is a note to self, and a single number would hide which is which.
 * The glyphs match the ones the comment pane uses for the same two scopes.
 */
export function BoardCommentBadges({
  counts,
  active,
}: {
  counts: BoardCommentCounts | undefined;
  /** On the selected row, which sits on the primary fill. */
  active: boolean;
}) {
  if (!counts || (counts.shared === 0 && counts.local === 0)) return null;
  return (
    <span className="flex shrink-0 items-center gap-1">
      {counts.shared > 0 ? (
        <Badge
          data-testid="board-comments-shared"
          variant="secondary"
          title={openCommentsLabel(counts.shared, "shared")}
          className={cn(
            "h-4 gap-0.5 bg-primary/10 px-1.5 text-[10px] text-primary tabular-nums",
            active && "bg-primary-foreground text-primary",
          )}
        >
          <Cloud aria-hidden="true" />
          <span aria-hidden="true">{counts.shared}</span>
          <span className="sr-only">{openCommentsLabel(counts.shared, "shared")}</span>
        </Badge>
      ) : null}
      {counts.local > 0 ? (
        <Badge
          data-testid="board-comments-local"
          variant="outline"
          title={openCommentsLabel(counts.local, "local")}
          className={cn(
            "h-4 gap-0.5 px-1.5 text-[10px] tabular-nums text-muted-foreground",
            active && "border-primary-foreground/50 text-primary-foreground",
          )}
        >
          <MessageCircle aria-hidden="true" />
          <span aria-hidden="true">{counts.local}</span>
          <span className="sr-only">{openCommentsLabel(counts.local, "local")}</span>
        </Badge>
      ) : null}
    </span>
  );
}
