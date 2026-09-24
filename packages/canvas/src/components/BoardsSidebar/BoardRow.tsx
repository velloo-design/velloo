import {
  Archive,
  Check,
  Download,
  ExternalLink,
  FolderInput,
  FolderPlus,
  Frame as FrameIcon,
  MoreHorizontal,
  Pencil,
  Share2,
  Trash2,
} from "lucide-react";
import type { DragEvent } from "react";
import type { BoardGroupMeta, BoardMeta } from "../../api.ts";
import { ICON_MENU_WIDTH } from "../../lib/utils.ts";
import { latestPublishForBoard, useCanvas } from "../../store.ts";
import { pushToast } from "../../toast.ts";
import { publishedWhen } from "../PublishedBoardsDialog.tsx";
import { Button } from "../ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.tsx";

const SWITCH_WHILE_DISCONNECTED = "Disconnected — board switching resumes when the daemon is back.";

/**
 * Open a board from the sidebar. Board data comes from the daemon, so
 * switching while disconnected would silently no-op — say so instead.
 */
export function useOpenBoard(): (boardId: string, active: boolean) => void {
  const selectBoard = useCanvas((s) => s.selectBoard);
  const wsConnected = useCanvas((s) => s.wsConnected);
  return (boardId, active) => {
    if (!wsConnected && !active) {
      pushToast({ kind: "error", message: SWITCH_WHILE_DISCONNECTED });
      return;
    }
    void selectBoard(boardId);
  };
}

/** A row's part in drag-reordering, bound to its board id by `useBoardDrag`. */
export interface BoardRowDrag {
  draggable: boolean;
  dragging: boolean;
  onDragStart(e: DragEvent<HTMLLIElement>): void;
  onDragOver(e: DragEvent<HTMLLIElement>): void;
  onDragEnd(): void;
}

interface BoardRowProps {
  board: BoardMeta;
  active: boolean;
  groups: BoardGroupMeta[];
  drag: BoardRowDrag;
  onRename(): void;
  onAddFrame(): void;
  onMoveToGroup(group: string | null): void;
  onNewGroup(): void;
  onArchive(): void;
  onDelete(): void;
}

/** One live board in the sidebar — rendered flat, or nested under its group's rail. */
export function BoardRow({
  board: b,
  active,
  groups,
  drag,
  onRename,
  onAddFrame,
  onMoveToGroup,
  onNewGroup,
  onArchive,
  onDelete,
}: BoardRowProps) {
  const wsConnected = useCanvas((s) => s.wsConnected);
  const pulsing = useCanvas((s) => Boolean(s.boardPulse[b.id]));
  const publishSlots = useCanvas((s) => s.publishSlots);
  const refreshPublishSlots = useCanvas((s) => s.refreshPublishSlots);
  const openBoard = useOpenBoard();
  const latestPublish = latestPublishForBoard(publishSlots, b.id);

  return (
    <li
      draggable={drag.draggable}
      onDragStart={drag.onDragStart}
      onDragOver={drag.onDragOver}
      onDragEnd={drag.onDragEnd}
      className={
        "relative group/board rounded-md " +
        (drag.draggable ? "cursor-grab active:cursor-grabbing " : "") +
        (drag.dragging ? "opacity-50" : "")
      }
    >
      <button
        type="button"
        onClick={() => openBoard(b.id, active)}
        title={!wsConnected && !active ? SWITCH_WHILE_DISCONNECTED : undefined}
        className={
          "w-full text-left px-2 py-1.5 pr-8 rounded-md text-sm transition-colors " +
          (active
            ? "bg-primary text-primary-foreground"
            : !wsConnected
              ? "text-muted-foreground cursor-not-allowed opacity-60"
              : "hover:bg-muted text-foreground")
        }
      >
        <div className="font-medium truncate">
          {b.name}
          {!active && pulsing ? (
            <span
              data-board-pulse={b.id}
              title="An agent edited this board recently"
              className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-primary align-middle"
            />
          ) : null}
        </div>
        <div
          className={`text-xs ${active ? "text-primary-foreground/80" : "text-muted-foreground"}`}
        >
          {b.frameCount} frame{b.frameCount === 1 ? "" : "s"}
        </div>
      </button>
      {/* Opening the menu is what re-reads the publish destinations: the
          "latest publish" item below is the only thing that needs them, and
          a link taken down elsewhere should stop being offered here. */}
      <DropdownMenu onOpenChange={(menuOpen) => menuOpen && void refreshPublishSlots()}>
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
          <DropdownMenuItem disabled={!wsConnected} onSelect={onRename}>
            <Pencil />
            Rename board
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!wsConnected} onSelect={onAddFrame}>
            <FrameIcon />
            Add frame…
          </DropdownMenuItem>
          {/* Who can see the link is the dialog's question, where every
              option (and what the plan allows) is laid out — not a submenu's. */}
          <DropdownMenuItem
            onSelect={() => useCanvas.getState().publishBoard({ id: b.id, name: b.name })}
            data-testid="board-publish"
          >
            <Share2 />
            Publish…
          </DropdownMenuItem>
          {/* Only for a board that has actually shipped a version — the point
              is to reach what reviewers are looking at, and a publish this
              board was never part of is someone else's link. */}
          {latestPublish ? (
            <DropdownMenuItem asChild>
              <a
                href={latestPublish.url}
                target="_blank"
                rel="noreferrer"
                className="text-inherit no-underline"
                title={`Published ${publishedWhen(latestPublish.lastPublishedAt)}`}
                data-testid="board-latest-publish"
              >
                <ExternalLink />
                See latest publish
              </a>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={!wsConnected}>
              <FolderInput />
              Move to group
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {groups.map((g) => (
                <DropdownMenuItem key={g.id} onSelect={() => onMoveToGroup(g.id)}>
                  <span
                    className="size-2.5 rounded-[3px]"
                    style={{ backgroundColor: g.color ?? "var(--muted-foreground)" }}
                  />
                  {g.name}
                  {b.group === g.id ? <Check className="ml-auto" /> : null}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem onSelect={() => onMoveToGroup(null)}>
                <span className="size-2.5 rounded-[3px] border border-dashed" />
                No group
                {b.group ? null : <Check className="ml-auto" />}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onNewGroup}>
                <FolderPlus />
                New group…
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem
            onSelect={() =>
              useCanvas.getState().setExportTarget({ kind: "board", id: b.id, name: b.name })
            }
          >
            <Download />
            Export board…
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!wsConnected} onSelect={onArchive}>
            <Archive />
            Archive board
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" disabled={!wsConnected} onSelect={onDelete}>
            <Trash2 />
            Delete board
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
