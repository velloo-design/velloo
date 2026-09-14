import { type Frame as FrameT, MAX_BOARD_NAME_LENGTH, type ViewportPreset } from "@velloo/schema";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { frameRenderSrc } from "../frame-render-src.ts";
import { useCanvas } from "../store.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { useAnchoredPaths } from "./Frame/anchored-paths.ts";
import { FrameHeader } from "./Frame/FrameHeader.tsx";
import { FrameViewportPresets } from "./Frame/FrameViewportPresets.tsx";
import { useChannelSync } from "./Frame/useChannelSync.ts";
import { type ScrollPos, useDoubleBuffer } from "./Frame/useDoubleBuffer.ts";
import { useFrameActions } from "./Frame/useFrameActions.ts";
import { useFrameChannel } from "./Frame/useFrameChannel.ts";
import { useFrameInteractions } from "./Frame/useFrameInteractions.ts";
import { useIframeOverrides } from "./Frame/useIframeOverrides.ts";
import { Loading } from "./Loading.tsx";
import { NameDialog } from "./NameDialog.tsx";

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
  const chromeHostRef = useRef<HTMLDivElement>(null);
  const screen = useCanvas((s) => s.screens[frame.screen]);
  const boardTheme = useCanvas((s) => s.boards[boardId]?.theme);
  // Per-screen version for the iframe cache-buster — editing another screen
  // must not reload this frame's iframe (only its own screen's edits should).
  const screenRev = useCanvas((s) => s.screenVersions[frame.screen] ?? 0);
  const themeVersion = useCanvas((s) => s.themeVersion);
  const designMode = useCanvas((s) => s.designMode);
  const cursorMode = useCanvas((s) => s.cursorMode);
  const wsConnected = useCanvas((s) => s.wsConnected);
  const canvasZoom = useCanvas((s) => s.canvasZoom);
  const setFrameInset = useCanvas((s) => s.setFrameInset);
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
  const { anchoredPaths, snippetPaths, anchoredPathsRef, snippetPathsRef } =
    useAnchoredPaths(frame);

  // The iframe src embeds only *committed* frame size — draft (mid-drag)
  // sizes stretch the element visually via width/height styling, so a resize
  // gesture doesn't navigate the iframe on every pointer-move tick; the one
  // reload happens on commit. While the daemon is unreachable the
  // src is frozen entirely: recomputing it (theme toggle, version bumps,
  // attempted resizes) would point the iframe at an unreachable /api/render
  // URL and blank the frame to gray.
  const computedSrc = frameRenderSrc({
    frame,
    canvasDefault: designMode,
    ...(boardTheme ? { boardTheme } : {}),
    screenRevision: screenRev,
    themeVersion,
  });
  const frozenSrcRef = useRef(computedSrc);
  if (wsConnected) frozenSrcRef.current = computedSrc;
  const src = frozenSrcRef.current;

  // Last scroll offset the iframe reported — restored after a reload so
  // theme toggles/edits and resize commits keep the user's place.
  const savedScrollRef = useRef<ScrollPos | null>(null);
  const { srcs, front, frontRef, slotRefs, settleSlot } = useDoubleBuffer(src, savedScrollRef);

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

  const channelRef = useFrameChannel({
    boardId,
    frame,
    iframeRef: frontRef,
    hasScreen,
    savedScrollRef,
    anchoredPathsRef,
    snippetPathsRef,
  });
  useChannelSync(channelRef, frame, anchoredPaths, snippetPaths);
  useIframeOverrides({
    slotRefs,
    front,
    screenRev,
    hasScreen,
    frontIsCurrent: srcs[front] === src,
  });

  // Frame-level glow for screen-, frame-, and theme-level agent ops.
  useEffect(() => {
    if (!glowNonce) return;
    setGlowing(true);
    const timer = setTimeout(() => setGlowing(false), 1400);
    return () => clearTimeout(timer);
  }, [glowNonce]);

  const frameLabel = frame.label ?? screen?.name ?? frame.screen;
  const actions = useFrameActions({ boardId, frame, frameLabel, boardTheme });
  const passThrough = cursorMode === "hand";

  return (
    <div
      className="absolute group"
      style={{ left: x, top: y }}
      data-frame-id={frame.id}
      data-group-id={frame.group ?? ""}
    >
      <div className="flex flex-col gap-1">
        {/*
          Counter-scale the chrome against the board zoom so the title, size
          inputs, and menu render at a constant, readable size. The layout box
          is sized to w×zoom and scaled back by 1/zoom, so the visual width
          always matches the frame; origin bottom-left grows the row upward,
          away from the iframe.
        */}
        <div
          style={{
            width: `calc(${w}px * var(--canvas-zoom, 1))`,
            transform: "scale(calc(1 / var(--canvas-zoom, 1)))",
            transformOrigin: "bottom left",
          }}
        >
          <FrameHeader
            label={frameLabel}
            w={w}
            h={h}
            sharedCount={sharedCount}
            library={screen?.library ?? null}
            presets={presets}
            scheme={frame.scheme}
            canvasDefault={designMode}
            chromeWidth={w * canvasZoom}
            onPointerDownGrip={startDrag}
            onRemove={actions.requestRemove}
            onExport={actions.onExport}
            onResize={actions.onResize}
            onPreview={actions.onPreview}
            onAddSibling={actions.onAddSibling}
            onSchemeChange={actions.onSchemeChange}
            moveTargets={actions.moveTargets}
            onMoveToBoard={actions.onMoveToBoard}
            onMoveToNewBoard={() => actions.setNewBoardName(frameLabel)}
          />
        </div>

        {!screen ? (
          <div
            style={{ width: w, height: h }}
            className="border border-dashed border-muted-foreground/30 rounded-md grid place-items-center text-xs text-muted-foreground"
          >
            <Loading size={28} label={frame.screen} className="flex-col" />
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
            {([0, 1] as const).map((slot) =>
              srcs[slot] === null ? null : (
                <iframe
                  key={slot}
                  ref={slotRefs[slot]}
                  title={`${screen.name} (${frame.id})${slot === front ? "" : " — loading"}`}
                  src={srcs[slot] as string}
                  width={w}
                  height={h}
                  onLoad={() => {
                    // First paint of the visible slot (initial mount) — start the handshake.
                    if (settleSlot(slot)) channelRef.current?.attach();
                  }}
                  aria-hidden={slot === front ? undefined : true}
                  className={
                    "velloo-frame-iframe absolute inset-0 border rounded-md bg-white" +
                    (slot === front ? "" : " invisible")
                  }
                  style={{
                    width: w,
                    height: h,
                    pointerEvents: slot === front && !passThrough ? "auto" : "none",
                  }}
                />
              ),
            )}
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

        <div
          style={{
            width: `calc(${w}px * var(--canvas-zoom, 1))`,
            transform: "scale(calc(1 / var(--canvas-zoom, 1)))",
            transformOrigin: "top left",
          }}
        >
          <FrameViewportPresets frame={frame} presets={presets} onPick={actions.onPickPreset} />
        </div>
      </div>

      <ConfirmDialog
        open={actions.confirmRemove}
        title="Remove frame"
        description={`Remove this placement of "${frameLabel}" from the board? The underlying screen stays — only this frame is removed. You can put it back with ⌘Z.`}
        confirmLabel="Remove"
        onConfirm={actions.doRemove}
        onCancel={actions.cancelRemove}
      />

      <NameDialog
        open={actions.newBoardName !== null}
        title="Move to a new board"
        placeholder="Board name"
        submitLabel="Create and move"
        maxLength={MAX_BOARD_NAME_LENGTH}
        value={actions.newBoardName ?? ""}
        onValueChange={actions.setNewBoardName}
        onSubmit={() => void actions.submitNewBoard()}
        onCancel={() => actions.setNewBoardName(null)}
      />
    </div>
  );
});
