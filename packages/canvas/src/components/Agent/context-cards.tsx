import type { AgentContextCard, AgentContextKind } from "@velloo/protocol/agent";
import {
  Frame,
  Image,
  LayoutDashboard,
  type LucideIcon,
  MessageSquareText,
  Monitor,
  Plus,
  SquareMousePointer,
  StickyNote,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { Avatar, AvatarFallback } from "../ui/avatar.tsx";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "../ui/item.tsx";

const ICONS: Record<AgentContextKind, LucideIcon> = {
  board: LayoutDashboard,
  screen: Monitor,
  frame: Frame,
  node: SquareMousePointer,
  preview: Image,
  note: StickyNote,
  comment: MessageSquareText,
};

/** Why a card in the composer no longer points where it did. */
export type CardStaleness = "changed" | "gone" | "resolved";

const STALE_LABEL: Record<CardStaleness, string> = {
  changed: "Changed",
  gone: "Deleted",
  resolved: "Resolved",
};

/** "Pricing › Hero › Button", with the last step emphasised. */
function Breadcrumb({ label }: { label: string }) {
  const parts = label.split(" › ");
  const last = parts.pop();
  return (
    <>
      {parts.length ? `${parts.join(" › ")} › ` : ""}
      <span className="font-medium text-foreground">{last}</span>
    </>
  );
}

/**
 * One piece of canvas context: a suggestion to add (dashed), a card attached
 * to the draft (removable), or a card on a sent message (read-only).
 */
export function ContextChip({
  card,
  variant,
  stale,
  onAdd,
  onRemove,
}: {
  card: AgentContextCard;
  variant: "suggested" | "attached" | "sent";
  stale?: CardStaleness | undefined;
  onAdd?: () => void;
  onRemove?: () => void;
}) {
  const Icon = ICONS[card.kind];
  if (variant === "suggested") {
    return (
      <Button
        variant="outline"
        size="xs"
        className="max-w-full border-dashed bg-transparent font-normal text-muted-foreground"
        onClick={onAdd}
        aria-label={`Attach ${card.kind} ${card.label}`}
        data-agent-suggestion={card.kind}
      >
        <Plus size={12} aria-hidden />
        <span className="truncate">{card.label.split(" › ").pop()}</span>
      </Button>
    );
  }
  if (variant === "attached") {
    return (
      <Badge
        variant="outline"
        className={`h-6 max-w-full gap-1 bg-background pr-0.5 pl-2 font-normal ${stale ? "opacity-60" : ""}`}
        title={card.label}
        data-agent-card={card.kind}
      >
        <Icon size={12} aria-hidden />
        <span className="truncate">{card.label.split(" › ").pop()}</span>
        {stale ? (
          <span className="text-[10px] text-muted-foreground">· {STALE_LABEL[stale]}</span>
        ) : null}
        <Button
          variant="ghost"
          size="icon-xs"
          className="size-5 rounded-full text-muted-foreground"
          onClick={onRemove}
          aria-label={`Remove ${card.label}`}
        >
          <X size={12} aria-hidden />
        </Button>
      </Badge>
    );
  }
  return (
    <Item variant="outline" size="xs" className="w-fit max-w-full gap-1.5 bg-background px-2 py-1">
      <ItemMedia variant="icon">
        <Icon size={12} className="text-muted-foreground" aria-hidden />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="text-[11px] font-normal text-muted-foreground">
          <span className="truncate">
            <Breadcrumb label={card.label} />
          </span>
        </ItemTitle>
      </ItemContent>
    </Item>
  );
}

/** A comment carried to the agent: who wrote it, what it says, where it points. */
export function CommentCard({
  card,
  stale,
  status,
  action,
}: {
  card: AgentContextCard;
  stale?: CardStaleness | undefined;
  status?: ReactNode;
  action?: ReactNode;
}) {
  const author = card.author ?? "Comment";
  return (
    <Item
      variant="outline"
      size="xs"
      className={`bg-background ${stale ? "opacity-60" : ""}`}
      data-agent-comment={card.ref.threadId}
      aria-label={`Comment by ${author}: ${card.detail ?? ""}`}
    >
      <ItemMedia className="self-start">
        <Avatar className="size-5" size="sm">
          <AvatarFallback className="text-[10px]">{author.charAt(0).toUpperCase()}</AvatarFallback>
        </Avatar>
      </ItemMedia>
      <ItemContent className="min-w-0 gap-0.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <ItemTitle className="truncate text-xs">{author}</ItemTitle>
          {stale ? (
            <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
              {STALE_LABEL[stale]}
            </Badge>
          ) : null}
          {status}
        </div>
        {card.detail ? (
          <ItemDescription className="line-clamp-2 text-xs text-foreground">
            {card.detail}
          </ItemDescription>
        ) : null}
        <span className="truncate text-[11px] text-muted-foreground">{card.label}</span>
      </ItemContent>
      {action ? <ItemActions className="self-start">{action}</ItemActions> : null}
    </Item>
  );
}
