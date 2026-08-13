import type { Frame as FrameT } from "@velloo/schema";
import { useEffect, useRef } from "react";
import { renderUrl } from "../api.ts";
import { IframeChannel } from "../iframe-channel.ts";
import { useCanvas } from "../store.ts";

interface FrameProps {
  frame: FrameT;
}

/**
 * A single placement on the Board: an iframe at the frame's chosen size,
 * rendering the referenced screen. Selecting a node inside any frame of a
 * given screen updates the global selection (and all other frames of that
 * screen highlight the same node, because they share the underlying tree).
 */
export function Frame({ frame }: FrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const channelRef = useRef<IframeChannel | null>(null);
  const screen = useCanvas((s) => s.screens[frame.screen]);
  const screenVersion = useCanvas((s) => s.screenVersion);
  const selection = useCanvas((s) => s.selection);
  const hover = useCanvas((s) => s.hover);
  const designMode = useCanvas((s) => s.designMode);
  const setSelection = useCanvas((s) => s.setSelection);
  const setHover = useCanvas((s) => s.setHover);
  const setNodeRects = useCanvas((s) => s.setNodeRects);

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
    return () => {
      iframe.removeEventListener("load", onLoad);
      channel.destroy();
      channelRef.current = null;
    };
  }, [frame.screen, setSelection, setHover, setNodeRects]);

  // Push highlight + hover state to the iframe whenever selection or hover
  // targets a node inside this frame's screen.
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

  if (!screen) {
    return (
      <div
        style={{ width: frame.w, height: frame.h }}
        className="border border-dashed border-[var(--color-fg-muted)]/30 rounded-md grid place-items-center text-xs text-[var(--color-fg-muted)]"
      >
        Loading {frame.screen}…
      </div>
    );
  }

  // Cache-bust the iframe src whenever the screen tree mutates so we don't
  // serve a stale render. Mode flips remount as well so the .dark class lands.
  const src = `${renderUrl(frame.screen, frame.w, frame.h)}&mode=${designMode}&v=${screenVersion}`;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-xs text-[var(--color-fg-muted)]">
        <span className="font-medium">{frame.label ?? screen.name}</span>
        <span className="opacity-50">
          {frame.w}×{frame.h}
        </span>
      </div>
      <iframe
        ref={iframeRef}
        title={`${screen.name} (${frame.id})`}
        src={src}
        width={frame.w}
        height={frame.h}
        className="border border-[var(--color-border)] rounded-md bg-white"
        style={{ width: frame.w, height: frame.h }}
      />
    </div>
  );
}
