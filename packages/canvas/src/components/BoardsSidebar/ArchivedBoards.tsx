import { Archive, ArchiveRestore, ChevronRight, MoreHorizontal, Trash2 } from "lucide-react";
import type { BoardMeta } from "../../api.ts";
import { ICON_MENU_WIDTH } from "../../lib/utils.ts";
import { useCanvas } from "../../store.ts";
import { CollapsePanel } from "../CollapsePanel.tsx";
import { Button } from "../ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.tsx";
import { useOpenBoard } from "./BoardRow.tsx";

/** "Aug 25" — enough to date an archived board without widening the row. */
function archivedOn(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "archived";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface Props {
  boards: BoardMeta[];
  currentBoardId: string | null;
  open: boolean;
  onToggle(): void;
  onRestore(board: BoardMeta): void;
  onDelete(board: BoardMeta): void;
}

/** The archive footer: a collapsible filing cabinet under the live boards. */
export function ArchivedBoards({
  boards,
  currentBoardId,
  open,
  onToggle,
  onRestore,
  onDelete,
}: Props) {
  const wsConnected = useCanvas((s) => s.wsConnected);
  const openBoard = useOpenBoard();
  return (
    <div className="shrink-0 border-t px-2 py-1.5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[11px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRight
          size={13}
          strokeWidth={2.5}
          className={
            "shrink-0 transition-transform duration-200 motion-reduce:transition-none " +
            (open ? "rotate-90" : "")
          }
        />
        <Archive size={11} strokeWidth={2} className="shrink-0" /> Archived
        <span className="normal-case opacity-60">({boards.length})</span>
      </button>
      <CollapsePanel open={open}>
        <ul className="mt-0.5 flex flex-col gap-0.5">
          {boards.map((b) => {
            const active = b.id === currentBoardId;
            return (
              <li key={b.id} className="relative group/board rounded-md">
                <button
                  type="button"
                  onClick={() => openBoard(b.id, active)}
                  // An archived board is still fully editable — opening
                  // one is normal, it just isn't in the way by default.
                  className={
                    "w-full text-left px-2 py-1.5 pr-8 rounded-md text-sm transition-colors " +
                    (active
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted text-muted-foreground")
                  }
                >
                  <div className="truncate">{b.name}</div>
                  <div
                    className={
                      "text-xs " +
                      (active ? "text-primary-foreground/80" : "text-muted-foreground/70")
                    }
                  >
                    {b.frameCount} frame{b.frameCount === 1 ? "" : "s"}
                    {b.archivedAt ? ` · ${archivedOn(b.archivedAt)}` : ""}
                  </div>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      title="Board menu"
                      className="absolute right-2 top-2 opacity-0 group-hover/board:opacity-100 data-[state=open]:opacity-100"
                    >
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className={ICON_MENU_WIDTH}>
                    <DropdownMenuItem disabled={!wsConnected} onSelect={() => onRestore(b)}>
                      <ArchiveRestore />
                      Restore board
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      disabled={!wsConnected}
                      onSelect={() => onDelete(b)}
                    >
                      <Trash2 />
                      Delete board
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            );
          })}
        </ul>
      </CollapsePanel>
    </div>
  );
}
