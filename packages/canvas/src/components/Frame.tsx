import type { Frame as FrameT, ViewportPreset } from "@velloo/schema";
import { useEffect, useRef, useState } from "react";
import { mutate, renderUrl } from "../api.ts";
import { IframeChannel } from "../iframe-channel.ts";
import { useCanvas } from "../store.ts";
import { toastError } from "../toast.ts";
import { FrameHeader } from "./Frame/FrameHeader.tsx";
import { FrameViewportPresets } from "./Frame/FrameViewportPresets.tsx";
import { useFrameInteractions } from "./Frame/useFrameInteractions.ts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog.tsx";

interface FrameProps {
  boardId: string;
  frame: FrameT;
  otherFrames: FrameT[];
  presets: ViewportPreset[];
  sharedCount: number;
}

/**
 * One placement on the Board: an iframe at the frame's chosen size, rendering
 * the referenced screen. Grab the header to drag; pull the edge handles to
 * resize. Resize clamps against neighboring frames so they never overlap.
 *
 * When the canvas cursor is in `hand` or `note` mode, the iframe's
 * pointer-events are disabled so the parent can capture drag/click through
 * the frame.
 */
export function Frame({ boardId, frame, otherFrames, presets, sharedCount }: FrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const channelRef = useRef<IframeChannel | null>(null);
  const screen = useCanvas((s) => s.screens[frame.screen]);
  const screenVersion = useCanvas((s) => s.screenVersion);
  const themeVersion = useCanvas((s) => s.themeVersion);
  const selection = useCanvas((s) => s.selection);
  const hover = useCanvas((s) => s.hover);
  const designMode = useCanvas((s) => s.designMode);
  const cursorMode = useCanvas((s) => s.cursorMode);
  const setSelection = useCanvas((s) => s.setSelection);
  const setHover = useCanvas((s) => s.setHover);
  const setNodeRects = useCanvas((s) => s.setNodeRects);
  const clearNodeRects = useCanvas((s) => s.clearNodeRects);
  const annotations = useCanvas((s) => s.annotations);

  const { draftPos, draftSize, startDrag, startResize } = useFrameInteractions({
    boardId,
    frame,
    otherFrames,
  });

  const w = draftSize?.w ?? frame.w;
  const h = draftSize?.h ?? frame.h;
  const x = draftPos?.x ?? frame.x;
  const y = draftPos?.y ?? frame.y;

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const channel = new IframeChannel(iframe, {
      onSelect(path) {
        if (path === null) setSelection(null);
        else setSelection({ screenId: frame.screen, path });
      },
      onHover(path) {
        if (path === null) setHover(null);
        else setHover({ screenId: frame.screen, path });
      },
      onRects(rects) {
        setNodeRects(frame.id, rects);
      },
      // Cmd/Ctrl + wheel inside the iframe → zoom the board. Same
      // factor as Board.tsx's own onWheel handler so the two routes
      // feel identical. clientX/Y are inside the iframe document; we
      // translate them to board-wrapper coords using the iframe's
      // bounding rect so zoom anchors on the cursor instead of (0,0).
      onParentZoom(deltaY, clientX, clientY) {
        const state = useCanvas.getState();
        const factor = deltaY > 0 ? 0.95 : 1.05;
        const iframeEl = iframeRef.current;
        const wrapper = iframeEl?.closest<HTMLDivElement>('[data-velloo-board="true"]');
        if (!iframeEl || !wrapper) {
          state.setCanvasZoom(state.canvasZoom * factor);
          return;
        }
        const iframeRect = iframeEl.getBoundingClientRect();
        const wrapperRect = wrapper.getBoundingClientRect();
        // No scrollLeft/scrollTop — the board wrapper is
        // `overflow-hidden`; pan is the only movement axis.
        const anchorX = iframeRect.left - wrapperRect.left + clientX * state.canvasZoom;
        const anchorY = iframeRect.top - wrapperRect.top + clientY * state.canvasZoom;
        const nextZoom = Math.max(0.1, Math.min(4, state.canvasZoom * factor));
        if (nextZoom === state.canvasZoom) return;
        const worldX = (anchorX - state.pan.x) / state.canvasZoom;
        const worldY = (anchorY - state.pan.y) / state.canvasZoom;
        state.setCanvasZoom(nextZoom);
        state.setPan({
          x: Math.round(anchorX - worldX * nextZoom),
          y: Math.round(anchorY - worldY * nextZoom),
        });
      },
      // Plain wheel/trackpad inside the iframe → pan the board. Matches
      // the parent board's own onWheel handler so panning feels the
      // same whether the cursor sits over a frame or the grid.
      onParentPan(deltaX, deltaY) {
        const state = useCanvas.getState();
        state.setPan({ x: state.pan.x - deltaX, y: state.pan.y - deltaY });
      },
    });
    channelRef.current = channel;
    const onLoad = () => channel.attach();
    iframe.addEventListener("load", onLoad);
    // Already loaded (hot reload, fast network, etc.) — attach now.
    if (iframe.contentDocument?.readyState === "complete") channel.attach();
    return () => {
      iframe.removeEventListener("load", onLoad);
      channel.destroy();
      channelRef.current = null;
      clearNodeRects(frame.id);
    };
  }, [frame.id, frame.screen, setSelection, setHover, setNodeRects, clearNodeRects]);

  useEffect(() => {
    const channel = channelRef.current;
    if (!channel) return;
    if (selection?.screenId === frame.screen) {
      channel.send({ type: "applyHighlight", path: selection.path });
    } else {
      channel.send({ type: "clearHighlight" });
    }
  }, [selection, frame.screen]);

  useEffect(() => {
    const channel = channelRef.current;
    if (!channel) return;
    if (hover?.screenId === frame.screen) {
      channel.send({ type: "applyHover", path: hover.path });
    } else {
      channel.send({ type: "clearHover" });
    }
  }, [hover, frame.screen]);

  // Ask the iframe to report rects for every annotated path on this
  // screen. The channel buffers until handshake completes; once the
  // iframe re-renders (screenVersion bump), we re-request so the rects
  // stay fresh after edits. AnnotationsLayer reads what comes back and
  // anchors each annotation to the actual node geometry.
  useEffect(() => {
    void screenVersion;
    const channel = channelRef.current;
    if (!channel) return;
    const annotatedPaths = annotations
      .filter((a) => a.resolved !== null)
      .map((a) => (a.resolved ?? []).join("."));
    if (annotatedPaths.length === 0) {
      clearNodeRects(frame.id);
      return;
    }
    channel.send({ type: "requestRects", paths: annotatedPaths });
  }, [annotations, frame.id, screenVersion, clearNodeRects]);

  const onPickPreset = (preset: ViewportPreset) => {
    if (preset.w === frame.w && preset.h === frame.h) return;
    void mutate
      .updateFrame({ boardId, frameId: frame.id, patch: { w: preset.w, h: preset.h } })
      .catch((err) => toastError(err, "Could not resize frame"));
  };

  const [confirmRemove, setConfirmRemove] = useState(false);

  const onRemove = () => setConfirmRemove(true);

  const doRemove = () => {
    setConfirmRemove(false);
    void mutate
      .removeFrame({ boardId, frameId: frame.id })
      .catch((err) => toastError(err, "Could not remove frame"));
  };

  const onResize = (patch: { w?: number; h?: number }) => {
    void mutate
      .updateFrame({ boardId, frameId: frame.id, patch })
      .catch((err) => toastError(err, "Could not resize frame"));
  };

  const passThrough = cursorMode === "hand" || cursorMode === "note";

  return (
    <div
      className="absolute group"
      style={{ left: x, top: y }}
      data-frame-id={frame.id}
      data-group-id={frame.group ?? ""}
    >
      <div className="flex flex-col gap-1">
        <FrameHeader
          label={frame.label ?? screen?.name ?? frame.screen}
          w={w}
          h={h}
          sharedCount={sharedCount}
          library={screen?.library ?? null}
          onPointerDownGrip={startDrag}
          onRemove={onRemove}
          onResize={onResize}
        />

        {!screen ? (
          <div
            style={{ width: w, height: h }}
            className="border border-dashed border-muted-foreground/30 rounded-md grid place-items-center text-xs text-muted-foreground"
          >
            Loading {frame.screen}…
          </div>
        ) : (
          <div className="relative" style={{ width: w, height: h }}>
            <iframe
              ref={iframeRef}
              title={`${screen.name} (${frame.id})`}
              src={`${renderUrl(frame.screen, w, h)}&mode=${designMode}&v=${screenVersion}.${themeVersion}`}
              width={w}
              height={h}
              className="velloo-frame-iframe border rounded-md bg-white"
              style={{
                width: w,
                height: h,
                pointerEvents: passThrough ? "none" : "auto",
              }}
            />
            {/*
              Resize handles. Faint dashed edge by default; firms up on
              hover but stays accent/40 rather than full accent so the
              frame's content isn't drowned out.
            */}
            <div
              onPointerDown={startResize("e")}
              className="absolute top-0 right-0 h-full w-0.5 cursor-ew-resize opacity-0 group-hover:opacity-100 transition-opacity border-r border-dashed border-primary/40 hover:border-solid hover:border-r-2 hover:border-primary/70"
              role="presentation"
            />
            <div
              onPointerDown={startResize("s")}
              className="absolute bottom-0 left-0 w-full h-0.5 cursor-ns-resize opacity-0 group-hover:opacity-100 transition-opacity border-b border-dashed border-primary/40 hover:border-solid hover:border-b-2 hover:border-primary/70"
              role="presentation"
            />
            <div
              onPointerDown={startResize("se")}
              className="absolute bottom-0 right-0 h-2 w-2 cursor-nwse-resize opacity-0 group-hover:opacity-100 transition-opacity bg-primary/50 hover:bg-primary rounded-br"
              role="presentation"
            />
          </div>
        )}

        <FrameViewportPresets frame={frame} presets={presets} onPick={onPickPreset} />
      </div>
      <AlertDialog
        open={confirmRemove}
        onOpenChange={(open) => {
          if (!open) setConfirmRemove(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove frame</AlertDialogTitle>
            <AlertDialogDescription>
              {`Remove this placement of "${frame.label ?? screen?.name ?? frame.screen}" from the board? The underlying screen stays — only this frame is removed. You can put it back with ⌘Z.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={doRemove}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
