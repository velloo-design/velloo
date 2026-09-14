import type { Frame as FrameT, ViewportPreset } from "@velloo/schema";
import { useMemo, useState } from "react";
import { type BoardMeta, mutate } from "../../api.ts";
import { useCanvas } from "../../store.ts";
import { pushToast, toastError } from "../../toast.ts";

/** Stable empty list so the summary-boards selector doesn't re-render every tick. */
const EMPTY_BOARDS: BoardMeta[] = [];

/** What the frame header's menu and the viewport presets do to a frame. */
export function useFrameActions({
  boardId,
  frame,
  frameLabel,
  boardTheme,
}: {
  boardId: string;
  frame: FrameT;
  frameLabel: string;
  boardTheme: string | undefined;
}) {
  // Move targets come from the summary (every live board), not `boards` — that
  // cache only holds boards the canvas has opened.
  const summaryBoards = useCanvas((s) => s.design?.boards ?? EMPTY_BOARDS);
  const [confirmRemove, setConfirmRemove] = useState(false);
  // Non-null while the "new board" dialog is open; holds the draft name.
  const [newBoardName, setNewBoardName] = useState<string | null>(null);

  const updateFrame = (patch: Parameters<typeof mutate.updateFrame>[0]["patch"], what: string) => {
    void mutate
      .updateFrame({ boardId, frameId: frame.id, patch })
      .catch((err) => toastError(err, what));
  };

  const onPickPreset = (preset: ViewportPreset) => {
    if (preset.w === frame.w && preset.h === frame.h) return;
    updateFrame({ w: preset.w, h: preset.h }, "Could not resize frame");
  };

  const onResize = (patch: { w?: number; h?: number }) =>
    updateFrame(patch, "Could not resize frame");

  const onSchemeChange = (scheme: "light" | "dark" | null) =>
    updateFrame({ scheme }, "Could not update frame color scheme");

  const doRemove = () => {
    setConfirmRemove(false);
    void mutate
      .removeFrame({ boardId, frameId: frame.id })
      .catch((err) => toastError(err, "Could not remove frame"));
  };

  const onExport = () => {
    useCanvas.getState().setExportTarget({ kind: "frame", id: frame.id, name: frameLabel });
  };

  const onPreview = () => {
    useCanvas.getState().setPreviewTarget({
      screenId: frame.screen,
      name: frameLabel,
      ...(boardTheme ? { boardTheme } : {}),
      ...(frame.scheme ? { scheme: frame.scheme } : {}),
      w: frame.w,
    });
  };

  // Sibling frame of the same screen at a chosen size — auto-positioned by
  // the server (right of the rightmost frame). Multiple frames of one screen
  // edit-sync by design, so this is the "desktop/tablet/mobile side by side"
  // affordance.
  const onAddSibling = (size: { w: number; h: number }) => {
    void mutate
      .addFrame({ boardId, screenId: frame.screen, w: size.w, h: size.h })
      .catch((err) => toastError(err, "Could not add frame"));
  };

  const moveTargets = useMemo(
    () => summaryBoards.filter((b) => b.id !== boardId).map((b) => ({ id: b.id, name: b.name })),
    [summaryBoards, boardId],
  );

  // The frame leaves the board you're looking at, so the toast is the only
  // trace of where it went — and the way back to it.
  const reportMove = (toBoardId: string, boardName: string) => {
    pushToast({
      kind: "info",
      message: `Moved "${frameLabel}" to "${boardName}"`,
      action: {
        label: "Open board",
        onClick: () => void useCanvas.getState().selectBoard(toBoardId),
      },
    });
  };

  const onMoveToBoard = (toBoardId: string) => {
    const name = moveTargets.find((b) => b.id === toBoardId)?.name ?? toBoardId;
    void mutate
      .moveFrame({ boardId, frameId: frame.id, toBoardId })
      .then(() => reportMove(toBoardId, name))
      .catch((err) => toastError(err, "Could not move frame"));
  };

  const submitNewBoard = async () => {
    const name = newBoardName?.trim();
    if (!name) return;
    setNewBoardName(null);
    try {
      const { boardId: toBoardId } = await mutate.addBoard({ name });
      await mutate.moveFrame({ boardId, frameId: frame.id, toBoardId });
      // The new board only reaches the sidebar through the summary.
      await useCanvas.getState().refreshDesignSummary();
      reportMove(toBoardId, name);
    } catch (err) {
      toastError(err, "Could not move frame to a new board");
    }
  };

  return {
    onPickPreset,
    onResize,
    onSchemeChange,
    onExport,
    onPreview,
    onAddSibling,
    moveTargets,
    onMoveToBoard,
    confirmRemove,
    requestRemove: () => setConfirmRemove(true),
    cancelRemove: () => setConfirmRemove(false),
    doRemove,
    newBoardName,
    setNewBoardName,
    submitNewBoard,
  };
}
