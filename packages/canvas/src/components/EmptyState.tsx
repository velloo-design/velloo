import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "./ui/empty.tsx";

interface Props {
  title: string;
  hint?: string | undefined;
  icon?: LucideIcon | undefined;
  /** Optional call-to-action rendered under the hint. */
  action?: ReactNode | undefined;
  /**
   * `panel` for a sidebar or inspector pane, where the full-page type scale
   * and padding would push the message out of a 320px column.
   */
  size?: "page" | "panel" | undefined;
}

/**
 * The canvas's one "nothing here" surface. It exists because the panels had
 * grown five hand-rolled copies of the same centered-muted-text div, each
 * drifting on padding and type size; routing them through `Empty` also gets
 * them the icon and title/description hierarchy none of them had.
 */
export function EmptyState({ title, hint, icon: Icon, action, size = "page" }: Props) {
  const panel = size === "panel";
  return (
    <Empty className={panel ? "flex-1 p-6" : "flex-1 p-12"}>
      <EmptyHeader>
        {Icon ? (
          <EmptyMedia variant="icon">
            <Icon />
          </EmptyMedia>
        ) : null}
        <EmptyTitle className={panel ? "text-xs" : "text-base"}>{title}</EmptyTitle>
        {hint ? (
          <EmptyDescription className={panel ? "text-xs" : undefined}>{hint}</EmptyDescription>
        ) : null}
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}
