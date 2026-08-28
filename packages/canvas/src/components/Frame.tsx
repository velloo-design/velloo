import type { Frame as FrameT, ViewportPreset } from "@velloo/schema";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { mutate, renderUrl } from "../api.ts";
import { wheelZoomFactor, zoomAtPoint } from "../board-geometry.ts";
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
  /**
   * The board's full frame list (stable per design refresh). The collision
   * set is derived here rather than passed pre-filtered so Board's props stay
   * referentially stable and `memo` can skip Frames on pan/zoom ticks.
   */
  frames: FrameT[];
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
 *
 * Memoized: pan/zoom ticks re-render only Board's transform wrapper, so a
 * Frame reconciles only when its own props or store subscriptions change.
 */
export const Frame = memo(function Frame({
  boardId,
  frame,
  frames,
  presets,
  sharedCount,
}: FrameProps) {
  const otherFrames = useMemo(() => frames.filter((f) => f.id !== frame.id), [frames, frame.id]);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const chromeHostRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<IframeChannel | null>(null);
  const screen = useCanvas((s) => s.screens[frame.screen]);
  const boardTheme = useCanvas((s) => s.boards[boardId]?.theme);
  const screenVersion = useCanvas((s) => s.screenVersion);
  // Per-screen version for the iframe cache-buster — editing another screen
  // must not reload this frame's iframe (only its own screen's edits should).
  const screenRev = useCanvas((s) => s.screenVersions[frame.screen] ?? 0);
  const themeVersion = useCanvas((s) => s.themeVersion);
  const selection = useCanvas((s) => s.selection);
  const hover = useCanvas((s) => s.hover);
  const reveal = useCanvas((s) => s.reveal);
  const nodeState = useCanvas((s) => s.nodeState);
  const designMode = useCanvas((s) => s.designMode);
  const cursorMode = useCanvas((s) => s.cursorMode);
  const setSelection = useCanvas((s) => s.setSelection);
  const setHover = useCanvas((s) => s.setHover);
  const setNodeRects = useCanvas((s) => s.setNodeRects);
  const clearNodeRects = useCanvas((s) => s.clearNodeRects);
  const setFrameInset = useCanvas((s) => s.setFrameInset);
  const annotations = useCanvas((s) => s.annotations);
  const activityFlash = useCanvas((s) => s.activityFlash[frame.screen]);
  const glowNonce = useCanvas((s) => s.frameGlow[frame.id]);
  const [glowing, setGlowing] = useState(false);

  const { draftPos, draftSize, startDrag, startResize } = useFrameInteractions({
    boardId,
    frame,
    otherFrames,
  });

  const w = draftSize?.w ?? frame.w;
  const h = draftSize?.h ?? frame.h;
  const x = draftPos?.x ?? frame.x;
  const y = draftPos?.y ?? frame.y;
  const hasScreen = Boolean(screen);

  // Measure the frame chrome instead of hardcoding its layout: the iframe's
  // offset from the frame origin (header row above) feeds annotation
  // anchoring, and the total vertical chrome feeds frame collision. The
  // ResizeObserver keeps the numbers true through chrome edits — label
  // wrapping, new badges, restyled headers.
  useEffect(() => {
    void hasScreen; // the measured host only exists once the screen loaded
    const host = chromeHostRef.current;
    if (!host) return;
    const column = host.parentElement;
    const report = () => {
      setFrameInset(frame.id, {
        x: host.offsetLeft,
        y: host.offsetTop,
        chromeH: (column?.offsetHeight ?? host.offsetHeight) - host.offsetHeight,
      });
    };
    report();
    const ro = new ResizeObserver(report);
    if (column) ro.observe(column);
    ro.observe(host);
    return () => {
      ro.disconnect();
      setFrameInset(frame.id, null);
    };
  }, [frame.id, hasScreen, setFrameInset]);

  useEffect(() => {
    void hasScreen; // re-run once the screen loads so a late-mounted iframe attaches
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
      // A reloaded iframe (screenVersion bump after an edit, HMR) comes up
      // with a blank document while the store still holds selection/hover —
      // and the effects below are keyed on those values, so nothing re-sends
      // them. Re-establish everything the parent believes is true, and
      // re-request annotation rects so anchors track the fresh layout.
      onReady() {
        const s = useCanvas.getState();
        if (s.selection?.screenId === frame.screen) {
          // A pending reveal means this selection came from a search jump and
          // the iframe just (re)loaded — scroll the node into view too.
          const scroll = s.reveal?.screenId === frame.screen && s.reveal.path === s.selection.path;
          channel.send({
            type: "applyHighlight",
            path: s.selection.path,
            ...(scroll ? { scroll } : {}),
          });
        }
        if (s.hover?.screenId === frame.screen) {
          channel.send({ type: "applyHover", path: s.hover.path });
        }
        if (s.nodeState !== "default" && s.selection?.screenId === frame.screen) {
          channel.send({ type: "applyVelloState", path: s.selection.path, state: s.nodeState });
        }
        const annotated = s.annotations
          .filter((a) => a.resolved !== null)
          .map((a) => (a.resolved ?? []).join("."));
        if (annotated.length > 0) {
          channel.send({ type: "requestRects", paths: annotated });
        }
      },
      // Cmd/Ctrl + wheel inside the iframe → zoom the board. Same
      // factor as Board.tsx's own onWheel handler so the two routes
      // feel identical. clientX/Y are inside the iframe document; we
      // translate them to board-wrapper coords using the iframe's
      // bounding rect so zoom anchors on the cursor instead of (0,0).
      onParentZoom(deltaY, clientX, clientY) {
        const state = useCanvas.getState();
        const factor = wheelZoomFactor(deltaY);
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
        const next = zoomAtPoint(anchorX, anchorY, factor, {
          zoom: state.canvasZoom,
          pan: state.pan,
        });
        if (next.zoom === state.canvasZoom) return;
        state.setCanvasZoom(next.zoom);
        state.setPan(next.pan);
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
    // hasScreen: a frame added to an open board first mounts as the "Loading…"
    // placeholder (iframe null); re-run once the screen loads so the channel
    // actually attaches and the frame becomes selectable.
  }, [frame.id, frame.screen, hasScreen, setSelection, setHover, setNodeRects, clearNodeRects]);

  useEffect(() => {
    const channel = channelRef.current;
    if (!channel) return;
    if (selection?.screenId === frame.screen) {
      channel.send({ type: "applyHighlight", path: selection.path });
    } else {
      channel.send({ type: "clearHighlight" });
    }
  }, [selection, frame.screen]);

  // Search jumps: scroll the revealed node into view inside the iframe (the
  // regular highlight effect above never scrolls — click selection is
  // already visible). Keyed on the reveal nonce so re-jumping to the same
  // node scrolls again after the user wandered off.
  useEffect(() => {
    const channel = channelRef.current;
    if (!channel || !reveal || reveal.screenId !== frame.screen) return;
    channel.send({ type: "applyHighlight", path: reveal.path, scroll: true });
  }, [reveal, frame.screen]);

  // Agent-activity node flash: a node an agent just touched pulses in
  // every frame showing that screen — no scroll, and the user's selection
  // highlight is restored (never stolen) when the pulse ends. The nonce
  // coalesces bursts: each bump extends the pulse instead of strobing.
  useEffect(() => {
    const channel = channelRef.current;
    if (!channel || !activityFlash || activityFlash.path === null) return;
    channel.send({ type: "applyHighlight", path: activityFlash.path });
    const timer = setTimeout(() => {
      const sel = useCanvas.getState().selection;
      if (sel?.screenId === frame.screen) {
        channel.send({ type: "applyHighlight", path: sel.path });
      } else {
        channel.send({ type: "clearHighlight" });
      }
    }, 1100);
    return () => clearTimeout(timer);
  }, [activityFlash, frame.screen]);

  // Frame-level glow for screen-, frame-, and theme-level agent ops.
  useEffect(() => {
    if (!glowNonce) return;
    setGlowing(true);
    const timer = setTimeout(() => setGlowing(false), 1400);
    return () => clearTimeout(timer);
  }, [glowNonce]);

  // One-shot geometry probe for fly-to-node navigation: answer with the
  // probed path's rect (plus the annotated paths, since a rects response
  // replaces this frame's whole registry entry).
  const rectProbe = useCanvas((s) => s.rectProbe);
  useEffect(() => {
    const channel = channelRef.current;
    if (!channel || !rectProbe || rectProbe.frameId !== frame.id) return;
    const annotatedPaths = annotations
      .filter((a) => a.resolved !== null)
      .map((a) => (a.resolved ?? []).join("."));
    channel.send({
      type: "requestRects",
      paths: [...new Set([rectProbe.path, ...annotatedPaths])],
    });
  }, [rectProbe, frame.id, annotations]);

  useEffect(() => {
    const channel = channelRef.current;
    if (!channel) return;
    if (hover?.screenId === frame.screen) {
      channel.send({ type: "applyHover", path: hover.path });
    } else {
      channel.send({ type: "clearHover" });
    }
  }, [hover, frame.screen]);

  // Force-state preview: when a node on this screen is selected and the
  // Inspector's State dropdown is off "default", drive the iframe to pin that
  // pseudo-state (the runtime sets [data-velloo-state], styled by the snapshot
  // CSS). Clears when nothing on this screen is selected or state is default.
  useEffect(() => {
    const channel = channelRef.current;
    if (!channel) return;
    const path = selection?.screenId === frame.screen ? selection.path : null;
    channel.send({ type: "applyVelloState", path, state: path ? nodeState : "default" });
  }, [nodeState, selection, frame.screen]);

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

  const onExport = () => {
    useCanvas.getState().setExportTarget({
      kind: "frame",
      id: frame.id,
      name: frame.label ?? screen?.name ?? frame.screen,
    });
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
          onExport={onExport}
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
          <div
            ref={chromeHostRef}
            className={
              "relative" +
              (glowing
                ? " rounded-md ring-2 ring-primary/70 shadow-[0_0_18px_2px] shadow-primary/25 transition-shadow duration-300"
                : "")
            }
            style={{ width: w, height: h }}
          >
            <iframe
              ref={iframeRef}
              title={`${screen.name} (${frame.id})`}
              src={`${renderUrl(frame.screen, w, h, boardTheme)}&mode=${designMode}&v=${screenRev}.${themeVersion}`}
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
});
