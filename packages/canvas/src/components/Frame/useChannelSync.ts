import type { Frame as FrameT } from "@velloo/schema";
import { type RefObject, useEffect } from "react";
import type { IframeChannel } from "../../iframe-channel.ts";
import { useCanvas } from "../../store.ts";

/**
 * Push canvas state into the frame's iframe as it changes: selection and
 * hover highlights, snippet focus, forced pseudo-states, reveal scrolls,
 * agent-activity flashes, and the rect/computed-style requests the parent
 * chrome anchors on. The reload-time replay of the same state lives in the
 * channel's `onReady`.
 */
export function useChannelSync(
  channelRef: RefObject<IframeChannel | null>,
  frame: FrameT,
  anchoredPaths: string[],
  snippetPaths: string[],
): void {
  const selection = useCanvas((s) => s.selection);
  const snippetFocus = useCanvas((s) => s.snippetFocus);
  const hover = useCanvas((s) => s.hover);
  const reveal = useCanvas((s) => s.reveal);
  const nodeState = useCanvas((s) => s.nodeState);
  const screenVersion = useCanvas((s) => s.screenVersion);
  const canvasZoom = useCanvas((s) => s.canvasZoom);
  const activityFlash = useCanvas((s) => s.activityFlash[frame.screen]);
  const rectProbe = useCanvas((s) => s.rectProbe);
  const clearNodeRects = useCanvas((s) => s.clearNodeRects);

  useEffect(() => {
    const channel = channelRef.current;
    if (!channel) return;
    if (selection?.screenId === frame.screen) {
      channel.send({ type: "applyHighlight", path: selection.path });
    } else if (snippetFocus !== null && selection?.screenId === `snippet:${snippetFocus}`) {
      // A definition path lights up in every instance at once.
      channel.send({ type: "applyHighlight", path: "", snippetPath: selection.path });
    } else {
      channel.send({ type: "clearHighlight" });
    }
  }, [channelRef, selection, snippetFocus, frame.screen]);

  // Scope the screen to one snippet — everything else dims and clicks inside
  // instances start addressing the definition.
  useEffect(() => {
    channelRef.current?.send({ type: "applySnippetFocus", snippetId: snippetFocus });
  }, [channelRef, snippetFocus]);

  // Search jumps: scroll the revealed node into view inside the iframe (the
  // regular highlight effect above never scrolls — click selection is
  // already visible). Keyed on the reveal nonce so re-jumping to the same
  // node scrolls again after the user wandered off.
  useEffect(() => {
    const channel = channelRef.current;
    if (!channel || !reveal || reveal.screenId !== frame.screen) return;
    channel.send({ type: "applyHighlight", path: reveal.path, scroll: true });
  }, [channelRef, reveal, frame.screen]);

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
  }, [channelRef, activityFlash, frame.screen]);

  // One-shot geometry probe for fly-to-node navigation: answer with the
  // probed path's rect (plus the comment paths, since a rects response
  // replaces this frame's whole registry entry).
  useEffect(() => {
    const channel = channelRef.current;
    if (!channel || !rectProbe || rectProbe.frameId !== frame.id) return;
    channel.send({
      type: "requestRects",
      paths: [...new Set([rectProbe.path, ...anchoredPaths])],
      snippetPaths,
    });
  }, [channelRef, rectProbe, frame.id, anchoredPaths, snippetPaths]);

  useEffect(() => {
    const channel = channelRef.current;
    if (!channel) return;
    if (hover?.screenId === frame.screen) {
      channel.send({ type: "applyHover", path: hover.path });
    } else if (snippetFocus !== null && hover?.screenId === `snippet:${snippetFocus}`) {
      channel.send({ type: "applyHover", path: "", snippetPath: hover.path });
    } else {
      channel.send({ type: "clearHover" });
    }
  }, [channelRef, hover, snippetFocus, frame.screen]);

  // Force-state preview: when a node on this screen is selected and the
  // Inspector's State dropdown is off "default", drive the iframe to pin that
  // pseudo-state (the runtime sets [data-velloo-state], styled by the snapshot
  // CSS). Clears when nothing on this screen is selected or state is default.
  useEffect(() => {
    const channel = channelRef.current;
    if (!channel) return;
    const path = selection?.screenId === frame.screen ? selection.path : null;
    channel.send({ type: "applyVelloState", path, state: path ? nodeState : "default" });
  }, [channelRef, nodeState, selection, frame.screen]);

  // Ask the iframe to report rects for every comment path in this
  // screen. The channel buffers until handshake completes; once the
  // iframe re-renders (screenVersion bump), we re-request so the rects
  // stay fresh after edits. AnnotationsLayer reads what comes back and
  // anchors each pin to the actual node geometry.
  useEffect(() => {
    void screenVersion;
    const channel = channelRef.current;
    if (!channel) return;
    if (anchoredPaths.length === 0 && snippetPaths.length === 0) {
      clearNodeRects(frame.id);
      return;
    }
    channel.send({ type: "requestRects", paths: anchoredPaths, snippetPaths });
  }, [channelRef, anchoredPaths, snippetPaths, frame.id, screenVersion, clearNodeRects]);

  // The selection ring is drawn in iframe pixels and the iframe is scaled by
  // the board, so without this a 2px ring becomes a 10px slab at 500% and
  // swallows the parent's zoom-constant resize grips.
  useEffect(() => {
    channelRef.current?.send({ type: "setChromeScale", scale: canvasZoom });
  }, [channelRef, canvasZoom]);

  // What the selected node's unset slots actually resolve to. Re-asked on every
  // screen version because an edit is exactly what changes the answer.
  useEffect(() => {
    void screenVersion;
    const channel = channelRef.current;
    if (!channel || selection?.screenId !== frame.screen) return;
    channel.send({ type: "requestComputed", path: selection.path });
  }, [channelRef, selection, frame.screen, screenVersion]);
}
