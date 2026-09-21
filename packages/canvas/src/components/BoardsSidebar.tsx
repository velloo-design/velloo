import { MAX_BOARD_NAME_LENGTH } from "@velloo/schema";
import { ChevronRight, FolderPlus, LayoutDashboard, Plus } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { type BoardGroupMeta, type BoardMeta, mutate, type ScreenMeta } from "../api.ts";
import { useCanvas } from "../store.ts";
import { pushToast, toastError } from "../toast.ts";
import { AddFrameDialog } from "./AddFrameDialog.tsx";
import { ArchivedBoards } from "./BoardsSidebar/ArchivedBoards.tsx";
import { BoardRow } from "./BoardsSidebar/BoardRow.tsx";
import { GroupHeader } from "./BoardsSidebar/GroupHeader.tsx";
import { ScreenTreeSection } from "./BoardsSidebar/ScreenTreeSection.tsx";
import { useBoardDrag } from "./BoardsSidebar/useBoardDrag.ts";
import { useBoardGroups } from "./BoardsSidebar/useBoardGroups.ts";
import { CollapsePanel } from "./CollapsePanel.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { NameDialog } from "./NameDialog.tsx";
import { Button } from "./ui/button.tsx";
import { Empty, EmptyDescription } from "./ui/empty.tsx";

/**
 * What a board delete took with it. Screens cascade because nothing but a
 * frame references one, and snippets cascade behind them once nothing reaches
 * them — both are quiet, so the toast has to name them.
 */
function deletedBoardSummary(
  name: string,
  removed: { removedScreenIds: string[]; removedSnippetIds: string[] },
): string {
  const also: string[] = [];
  const screens = removed.removedScreenIds.length;
  const snippets = removed.removedSnippetIds.length;
  if (screens > 0) also.push(`${screens} screen${screens === 1 ? "" : "s"}`);
  if (snippets > 0) also.push(`${snippets} unused snippet${snippets === 1 ? "" : "s"}`);
  if (also.length === 0) return `Deleted "${name}"`;
  return `Deleted "${name}" and ${also.join(" + ")}`;
}

/** Stable empty array so the `archivedBoards` selector doesn't re-render on every store tick. */
const EMPTY_BOARDS: BoardMeta[] = [];
/** Same, for the groups selector. */
const EMPTY_GROUPS: BoardGroupMeta[] = [];

interface Props {
  boards: BoardMeta[];
  screens: ScreenMeta[];
  currentBoardId: string | null;
  currentScreenId: string | null;
}

/**
 * The boards-mode left sidebar: list of boards plus the tree of the
 * active screen. The outer `<aside>` lives on the `Sidebar` shell so
 * it can swap this for `LibrarySidebar` without duplicating chrome.
 * Snippets live in the Library tab now.
 */
export function BoardsSidebar({ boards, screens, currentBoardId, currentScreenId }: Props) {
  const selectBoard = useCanvas((s) => s.selectBoard);
  const wsConnected = useCanvas((s) => s.wsConnected);
  const loggedIn = useCanvas((s) => s.authStatus?.loggedIn ?? false);
  const refreshPublishSlots = useCanvas((s) => s.refreshPublishSlots);
  const boardsCollapsed = useCanvas((s) => s.boardsCollapsed);
  const treeCollapsed = useCanvas((s) => s.treeCollapsed);
  const toggleBoardsCollapsed = useCanvas((s) => s.toggleBoardsCollapsed);
  const setBoardArchived = useCanvas((s) => s.setBoardArchived);
  const archivedBoards = useCanvas((s) => s.design?.archivedBoards ?? EMPTY_BOARDS);
  const groups = useCanvas((s) => s.design?.boardGroups ?? EMPTY_GROUPS);
  const groupsUi = useBoardGroups();

  const [pendingBoardDelete, setPendingBoardDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const [addFrameBoardId, setAddFrameBoardId] = useState<string | null>(null);

  // One dialog serves create and rename — same shape (a name input), only
  // the title and the mutation differ.
  const [nameDialog, setNameDialog] = useState<
    { mode: "create" } | { mode: "rename"; boardId: string } | null
  >(null);
  const [boardName, setBoardName] = useState("");

  const moveBoardToGroup = (boardId: string, group: string | null) => {
    void mutate
      .updateBoard({ boardId, patch: { group } })
      .then(() => useCanvas.getState().refreshDesignSummary())
      .catch((err: unknown) => toastError(err, "Could not move board"));
  };

  const openCreateDialog = () => {
    setBoardName("New board");
    setNameDialog({ mode: "create" });
  };

  const openRenameDialog = (b: BoardMeta) => {
    setBoardName(b.name);
    setNameDialog({ mode: "rename", boardId: b.id });
  };

  const submitNameDialog = async () => {
    const name = boardName.trim();
    if (!name || !nameDialog) return;
    const dialog = nameDialog;
    setNameDialog(null);
    if (dialog.mode === "create") {
      try {
        const r = await mutate.addBoard({ name });
        void selectBoard(r.boardId);
      } catch (err) {
        toastError(err, "Could not create board");
      }
    } else {
      try {
        await mutate.updateBoard({ boardId: dialog.boardId, patch: { name } });
      } catch (err) {
        toastError(err, "Could not rename board");
      }
    }
  };

  const confirmDeleteBoard = () => {
    if (!pendingBoardDelete) return;
    const { id, name } = pendingBoardDelete;
    setPendingBoardDelete(null);
    void (async () => {
      try {
        const r = await mutate.removeBoard({ boardId: id });
        // The `board-changed` broadcast also reconciles, but pruning here
        // keeps the initiator's sidebar honest even if the WS is down.
        useCanvas.getState().pruneScreens(r.removedScreenIds);
        await useCanvas.getState().pruneBoard(id);
        pushToast({ kind: "info", message: deletedBoardSummary(name, r) });
      } catch (e) {
        toastError(e, "Could not delete board");
      }
    })();
  };

  // Collapsed by default: the archive is a filing cabinet, not a second list.
  const [archivedOpen, setArchivedOpen] = useState(false);

  // Landing on an archived board (search, a shared ?board= link) with the
  // section shut would leave the sidebar showing no selection at all.
  const currentIsArchived = archivedBoards.some((b) => b.id === currentBoardId);
  useEffect(() => {
    if (currentIsArchived) setArchivedOpen(true);
  }, [currentIsArchived]);

  // Read the destinations once the account lands, so the first board menu
  // already knows whether to offer its publish rather than growing an item a
  // beat after it opens. Repeats inside the freshness window cost nothing.
  useEffect(() => {
    if (loggedIn) void refreshPublishSlots();
  }, [loggedIn, refreshPublishSlots]);

  const archiveBoard = (b: BoardMeta, archived: boolean) => {
    void (async () => {
      try {
        await setBoardArchived(b.id, archived);
        pushToast({
          kind: "info",
          message: archived ? `Archived "${b.name}"` : `Restored "${b.name}"`,
        });
        if (archived) setArchivedOpen(true);
      } catch (e) {
        toastError(e, archived ? "Could not archive board" : "Could not restore board");
      }
    })();
  };

  // Everything drag stays off while the daemon is unreachable.
  const drag = useBoardDrag({ boards, groups, enabled: wsConnected, onRefile: moveBoardToGroup });

  // The boards list never eats the whole pane: when both panels are
  // open it's capped at half so the tree stays visible; when the tree
  // is collapsed it grows to fill instead. Collapsing a panel drops it
  // to just its header. `min-h-0` lets the inner list scroll.
  const boardsSectionClass = boardsCollapsed
    ? "shrink-0 border-b"
    : treeCollapsed
      ? "flex-1 flex flex-col min-h-0 border-b"
      : "flex flex-col min-h-0 max-h-[50%] border-b";

  const renderBoardRow = (b: BoardMeta) => (
    <BoardRow
      key={b.id}
      board={b}
      active={b.id === currentBoardId}
      groups={groups}
      drag={drag.rowDrag(b.id)}
      onRename={() => openRenameDialog(b)}
      onAddFrame={() => setAddFrameBoardId(b.id)}
      onMoveToGroup={(group) => moveBoardToGroup(b.id, group)}
      onNewGroup={() => groupsUi.openDialog({ mode: "create", boardId: b.id })}
      onArchive={() => archiveBoard(b, true)}
      onDelete={() => setPendingBoardDelete({ id: b.id, name: b.name })}
    />
  );

  return (
    <>
      <section className={boardsSectionClass}>
        <div className="px-4 py-2 flex items-center justify-between gap-2 text-xs uppercase tracking-wider text-muted-foreground">
          <button
            type="button"
            onClick={toggleBoardsCollapsed}
            className="flex min-w-0 items-center gap-1.5 hover:text-foreground transition-colors"
            aria-expanded={!boardsCollapsed}
            title={boardsCollapsed ? "Expand boards" : "Collapse boards"}
          >
            <ChevronRight
              size={13}
              strokeWidth={2.5}
              className={
                "shrink-0 transition-transform duration-200 motion-reduce:transition-none " +
                (boardsCollapsed ? "" : "rotate-90")
              }
            />
            <LayoutDashboard size={11} strokeWidth={2} className="shrink-0" /> Boards
            {boardsCollapsed && boards.length > 0 ? (
              <span className="normal-case opacity-60">({boards.length})</span>
            ) : null}
          </button>
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => groupsUi.openDialog({ mode: "create" })}
              disabled={!wsConnected}
              title={wsConnected ? "New group" : "Disconnected — edits are paused."}
            >
              <FolderPlus />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={openCreateDialog}
              disabled={!wsConnected}
              title={wsConnected ? "New board" : "Disconnected — edits are paused."}
            >
              <Plus />
            </Button>
          </div>
        </div>
        <CollapsePanel
          open={!boardsCollapsed}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          {boards.length === 0 ? (
            <Empty className="gap-1 px-4 pb-2 pt-0">
              <EmptyDescription className="text-sm">
                {archivedBoards.length > 0
                  ? "No boards — everything's archived."
                  : "No boards yet."}
              </EmptyDescription>
            </Empty>
          ) : (
            <ul
              className="flex flex-1 flex-col gap-0.5 overflow-auto scroll-stable px-2 pb-2 min-h-0"
              onDragOver={drag.onListDragOver}
              onDrop={drag.onListDrop}
            >
              {drag.sections.map((section) => {
                const group = section.group;
                return group ? (
                  <li key={group.id}>
                    <GroupHeader
                      group={group}
                      count={section.boards.length}
                      collapsed={groupsUi.collapsed.includes(group.id)}
                      dropTarget={drag.dragGroup === group.id}
                      disabled={!wsConnected}
                      onToggle={() => groupsUi.toggle(group.id)}
                      onDragOver={(e) => drag.onGroupDragOver(e, group.id)}
                      onRename={() => groupsUi.openDialog({ mode: "rename", group })}
                      onRecolor={(color) => groupsUi.recolor(group.id, color)}
                      onDelete={() => groupsUi.requestDelete(group)}
                    />
                    <CollapsePanel open={!groupsUi.collapsed.includes(group.id)}>
                      <ul
                        className="ml-[15px] flex flex-col gap-0.5 border-l-2 pl-2"
                        style={{ borderColor: group.color ?? "var(--border)" }}
                      >
                        {section.boards.map(renderBoardRow)}
                      </ul>
                    </CollapsePanel>
                  </li>
                ) : (
                  <Fragment key="__ungrouped">
                    {groups.length > 0 && section.boards.length > 0 ? (
                      <li
                        onDragOver={(e) => drag.onGroupDragOver(e, null)}
                        className={
                          "mt-1 flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] uppercase tracking-wide text-muted-foreground " +
                          (drag.dragGroup === null && drag.dragging ? "bg-accent" : "")
                        }
                      >
                        <span className="size-2.5 shrink-0 rounded-[3px] border border-dashed" />
                        Ungrouped
                        <span className="ml-auto normal-case opacity-70">
                          {section.boards.length}
                        </span>
                      </li>
                    ) : null}
                    {section.boards.map(renderBoardRow)}
                  </Fragment>
                );
              })}
            </ul>
          )}
          {archivedBoards.length === 0 ? null : (
            <ArchivedBoards
              boards={archivedBoards}
              currentBoardId={currentBoardId}
              open={archivedOpen}
              onToggle={() => setArchivedOpen((v) => !v)}
              onRestore={(b) => archiveBoard(b, false)}
              onDelete={(b) => setPendingBoardDelete({ id: b.id, name: b.name })}
            />
          )}
        </CollapsePanel>
      </section>

      <ScreenTreeSection
        screens={screens}
        currentBoardId={currentBoardId}
        currentScreenId={currentScreenId}
      />

      <NameDialog
        open={nameDialog !== null}
        title={nameDialog?.mode === "rename" ? "Rename board" : "New board"}
        placeholder="Board name"
        submitLabel={nameDialog?.mode === "rename" ? "Rename" : "Create"}
        maxLength={MAX_BOARD_NAME_LENGTH}
        value={boardName}
        onValueChange={setBoardName}
        onSubmit={() => void submitNameDialog()}
        onCancel={() => setNameDialog(null)}
      />

      <NameDialog
        open={groupsUi.dialog !== null}
        title={groupsUi.dialog?.mode === "rename" ? "Rename group" : "New group"}
        placeholder="Group name"
        submitLabel={groupsUi.dialog?.mode === "rename" ? "Rename" : "Create"}
        maxLength={40}
        value={groupsUi.name}
        onValueChange={groupsUi.setName}
        onSubmit={() => void groupsUi.submitDialog()}
        onCancel={groupsUi.closeDialog}
      />

      <ConfirmDialog
        open={groupsUi.pendingDelete !== null}
        title="Delete group"
        description={
          groupsUi.pendingDelete
            ? `Delete the group "${groupsUi.pendingDelete.name}"? Its boards aren't deleted — they move to Ungrouped.`
            : ""
        }
        confirmLabel="Delete group"
        onConfirm={groupsUi.confirmDelete}
        onCancel={groupsUi.cancelDelete}
      />

      <AddFrameDialog boardId={addFrameBoardId} onClose={() => setAddFrameBoardId(null)} />

      <ConfirmDialog
        open={pendingBoardDelete !== null}
        title="Delete board"
        description={
          pendingBoardDelete
            ? `Delete board "${pendingBoardDelete.name}"? Screens only this board places are deleted with it, along with any snippet nothing else reaches afterwards. Screens another board also places are kept.`
            : ""
        }
        confirmLabel="Delete"
        onConfirm={confirmDeleteBoard}
        onCancel={() => setPendingBoardDelete(null)}
      />
    </>
  );
}
