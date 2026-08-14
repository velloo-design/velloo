import type { Frame as FrameT, ViewportPreset } from "@velloo/schema";
import { useEffect, useRef } from "react";
import { mutate, renderUrl } from "../api.ts";
import { IframeChannel } from "../iframe-channel.ts";
import { useCanvas } from "../store.ts";
import { toastError } from "../toast.ts";
import { FrameHeader } from "./Frame/FrameHeader.tsx";
import { FrameViewportPresets } from "./Frame/FrameViewportPresets.tsx";
import { useFrameInteractions } from "./Frame/useFrameInteractions.ts";

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
        setNodeRects(frame.screen, rects);
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
    };
  }, [frame.screen, setSelection, setHover, setNodeRects]);

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

  const onPickPreset = (preset: ViewportPreset) => {
    if (preset.w === frame.w && preset.h === frame.h) return;
    void mutate
      .updateFrame({ boardId, frameId: frame.id, patch: { w: preset.w, h: preset.h } })
      .catch((err) => toastError(err, "Could not resize frame"));
  };

  const onRemove = () => {
    void mutate
      .removeFrame({ boardId, frameId: frame.id })
      .catch((err) => toastError(err, "Could not remove frame"));
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
          onPointerDownGrip={startDrag}
          onRemove={onRemove}
        />

        {!screen ? (
          <div
            style={{ width: w, height: h }}
            className="border border-dashed border-[var(--color-fg-muted)]/30 rounded-md grid place-items-center text-xs text-[var(--color-fg-muted)]"
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
              className="border border-[var(--color-border)] rounded-md bg-white"
              style={{
                width: w,
                height: h,
                pointerEvents: passThrough ? "none" : "auto",
              }}
            />
            <div
              onPointerDown={startResize("e")}
              className="absolute top-0 right-0 h-full w-1.5 -mr-0.5 cursor-ew-resize opacity-0 group-hover:opacity-100 bg-[var(--color-accent)] rounded-r-md"
              role="presentation"
            />
            <div
              onPointerDown={startResize("s")}
              className="absolute bottom-0 left-0 w-full h-1.5 -mb-0.5 cursor-ns-resize opacity-0 group-hover:opacity-100 bg-[var(--color-accent)] rounded-b-md"
              role="presentation"
            />
            <div
              onPointerDown={startResize("se")}
              className="absolute bottom-0 right-0 h-3 w-3 -mb-0.5 -mr-0.5 cursor-nwse-resize opacity-0 group-hover:opacity-100 bg-[var(--color-accent)] rounded-br-md"
              role="presentation"
            />
          </div>
        )}

        <FrameViewportPresets frame={frame} presets={presets} onPick={onPickPreset} />
      </div>
    </div>
  );
}
