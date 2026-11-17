import type { SketchbookSubject } from "@velloo/schema";
import { ChevronRight, Images, type LucideIcon, Palette } from "lucide-react";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "../ui/item.tsx";

/** The two ways to start a sketchbook, as every entry point names them. */
export const SKETCHBOOK_FLOWS: {
  subject: SketchbookSubject;
  title: string;
  body: string;
  Icon: LucideIcon;
}[] = [
  {
    subject: "page",
    title: "Find a theme look",
    body: "See a page as mood boards and mocks before designing it.",
    Icon: Images,
  },
  {
    subject: "look",
    title: "Explore palettes & type",
    body: "Try colours and fonts side by side, then keep one as a theme look.",
    Icon: Palette,
  },
];

/** What a sketchbook's subject is called beside it: the flow it was started from. */
export const flowTitle = (subject: SketchbookSubject): string =>
  SKETCHBOOK_FLOWS.find((f) => f.subject === subject)?.title ?? subject;

/** One flow as a row to click: what it does, said plainly. */
export function FlowRow({
  subject,
  onPick,
  className,
}: {
  subject: SketchbookSubject;
  onPick: (subject: SketchbookSubject) => void;
  className?: string;
}) {
  const flow = SKETCHBOOK_FLOWS.find((f) => f.subject === subject);
  if (!flow) return null;
  return (
    <Item
      asChild
      variant="outline"
      size="sm"
      className={`cursor-pointer bg-background text-left hover:bg-muted/50 ${className ?? ""}`}
    >
      <button type="button" onClick={() => onPick(subject)} data-sketchbook-flow={subject}>
        <ItemMedia variant="icon">
          <flow.Icon className="size-[18px]" />
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle>{flow.title}</ItemTitle>
          <ItemDescription className="text-xs">{flow.body}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
        </ItemActions>
      </button>
    </Item>
  );
}
