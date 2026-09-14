import type { Frame as FrameT } from "@velloo/schema";
import { type RefObject, useEffect, useRef } from "react";
import { wheelZoomFactor, zoomAtPoint } from "../../board-geometry.ts";
import { IframeChannel } from "../../iframe-channel.ts";
import { selectedNode } from "../../store/selection.ts";
import { useCanvas } from "../../store.ts";
import type { ScrollPos } from "./useDoubleBuffer.ts";

interface Options {
  boardId: string;
  frame: FrameT;
  /** The visible buffer; the channel re-binds every time it swaps. */
  iframeRef: RefObject<HTMLIFrameElement | null>;
  hasScreen: boolean;
  savedScrollRef: RefObject<ScrollPos | null>;
  anchoredPathsRef: RefObject<string[]>;
  snippetPathsRef: RefObject<string[]>;
}

/**
 * The message channel to the frame's visible iframe: it turns the design
 * runtime's clicks, hovers, keys, wheel and geometry reports into canvas
 * state, and on every (re)load replays what the parent believes is true.
 */
export function useFrameChannel({
  boardId,
  frame,
  iframeRef,
  hasScreen,
  savedScrollRef,
  anchoredPathsRef,
  snippetPathsRef,
}: Options): RefObject<IframeChannel | null> {
  const channelRef = useRef<IframeChannel | null>(null);
  const setSelection = useCanvas((s) => s.setSelection);
  const setHover = useCanvas((s) => s.setHover);
  const setNodeRects = useCanvas((s) => s.setNodeRects);
  const setSelectionComputed = useCanvas((s) => s.setSelectionComputed);
  const clearNodeRects = useCanvas((s) => s.clearNodeRects);

  useEffect(() => {
    void hasScreen; // re-run once the screen loads so a late-mounted iframe attaches
    const iframe = iframeRef.current;
    if (!iframe) return;
    const channel = new IframeChannel(iframe, {
      onSelect(path, snippetPath, instance) {
        if (path === null) {
          setSelection(null);
          return;
        }
        const state = useCanvas.getState();
        // Editing a snippet in place: the click addresses the definition, so
        // the selection points at the synthetic `snippet:<id>` screen and every
        // instance follows the edit.
        if (state.snippetFocus !== null) {
          // Only the focused snippet is editable while the mode is open;
          // anything else is dimmed scenery, so clicking it just deselects.
          if (snippetPath === undefined) setSelection(null);
          else {
            setSelection({ screenId: `snippet:${state.snippetFocus}`, path: snippetPath });
            // After setSelection: re-clicking a different instance is the same
            // {screenId, path}, so the selection dedupe drops it and only the
            // anchor actually changes.
            useCanvas.getState().setSelectionAnchor({ frameId: frame.id, instance: instance ?? 0 });
          }
          return;
        }
        if (state.cursorMode === "note") {
          const node = selectedNode(state.screens, { screenId: frame.screen, path });
          if (!node) return;
          void state.createNote({
            attachment: {
              frameId: frame.id,
              screenId: frame.screen,
              locator: nodeLocator(node, path),
            },
          });
          return;
        }
        if (state.cursorMode === "comment") {
          const selection = { screenId: frame.screen, path };
          const node = selectedNode(state.screens, selection);
          const element = Array.from(
            iframe.contentDocument?.querySelectorAll<HTMLElement>("[data-node-path]") ?? [],
          ).find((candidate) => candidate.dataset.nodePath === path);
          if (!node || !element) return;
          const rect = element.getBoundingClientRect();
          const locator = nodeLocator(node, path);
          const ref = "$ref" in node ? node.$ref : "$snippet" in node ? node.$snippet : undefined;
          const text = element.textContent?.trim().replace(/\s+/g, " ").slice(0, 500);
          state.beginComment({
            kind: "node",
            boardId,
            frameId: frame.id,
            screenId: frame.screen,
            locator,
            bounds: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
            ...((ref || text) && { fingerprint: { ...(ref && { ref }), ...(text && { text }) } }),
          });
          return;
        }
        setSelection({ screenId: frame.screen, path });
      },
      onHover(path, snippetPath) {
        const focus = useCanvas.getState().snippetFocus;
        if (path === null) setHover(null);
        else if (focus !== null) {
          // Nothing outside the focused snippet is editable, so nothing
          // outside it lights up under the cursor either.
          if (snippetPath === undefined) setHover(null);
          else setHover({ screenId: `snippet:${focus}`, path: snippetPath });
        } else setHover({ screenId: frame.screen, path });
      },
      // Double-click on an instance opens the snippet up for editing in place.
      // On anything else it's a no-op — there is nothing further to open.
      onEnter(_path, snippetId) {
        if (snippetId === undefined) return;
        useCanvas.getState().setSnippetFocus(snippetId);
      },
      onExit() {
        useCanvas.getState().setSnippetFocus(null);
      },
      // Keyboard focus lives in the iframe once a node is clicked, so the
      // canvas's own shortcuts only reach it by way of this replay.
      onKey(init) {
        window.dispatchEvent(new KeyboardEvent("keydown", init));
      },
      onRects(rects) {
        setNodeRects(frame.id, rects);
      },
      onComputed(path, values) {
        setSelectionComputed(path, values);
      },
      onScrollPos(sx, sy) {
        savedScrollRef.current = { x: sx, y: sy };
        // Rects are viewport-relative, so scrolling invalidates every anchor —
        // pins, connectors and the selection handles alike.
        const paths = anchoredPathsRef.current;
        const snippets = snippetPathsRef.current;
        if (paths.length > 0 || snippets.length > 0)
          channel.send({ type: "requestRects", paths, snippetPaths: snippets });
      },
      // A reloaded iframe (screenVersion bump after an edit, HMR) comes up
      // with a blank document while the store still holds selection/hover —
      // and the sync effects are keyed on those values, so nothing re-sends
      // them. Re-establish everything the parent believes is true, and
      // re-request annotation rects so anchors track the fresh layout.
      onReady() {
        const s = useCanvas.getState();
        if (s.snippetFocus !== null) {
          channel.send({ type: "applySnippetFocus", snippetId: s.snippetFocus });
          if (s.selection?.screenId === `snippet:${s.snippetFocus}`) {
            channel.send({ type: "applyHighlight", path: "", snippetPath: s.selection.path });
          }
        }
        // Restore the pre-reload scroll offset — unless a reveal jump is
        // pending for this screen, whose scrollIntoView must win.
        const revealPending = s.reveal?.screenId === frame.screen;
        if (!revealPending && savedScrollRef.current) {
          channel.send({ type: "restoreScroll", ...savedScrollRef.current });
        }
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
        // The selection's path has to be in here: a rects response replaces
        // this frame's whole registry, so asking for the anchored set alone
        // drops the selection's box and the resize grips vanish on every
        // reload — which a live resize causes several times a second.
        const anchored = anchoredPathsRef.current;
        const snippets = snippetPathsRef.current;
        if (anchored.length > 0 || snippets.length > 0) {
          channel.send({ type: "requestRects", paths: anchored, snippetPaths: snippets });
        }
        channel.send({ type: "setChromeScale", scale: useCanvas.getState().canvasZoom });
        if (s.selection?.screenId === frame.screen) {
          channel.send({ type: "requestComputed", path: s.selection.path });
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
        const wrapper = iframe.closest<HTMLDivElement>('[data-velloo-board="true"]');
        if (!wrapper) {
          state.zoomAtViewportCenter({ factor });
          return;
        }
        const iframeRect = iframe.getBoundingClientRect();
        const wrapperRect = wrapper.getBoundingClientRect();
        // Map iframe-local client coords into wrapper space. Prefer the
        // live element scale (rect/clientWidth) over store zoom — they can
        // diverge mid-flight during animated camera moves.
        const scaleX =
          iframe.clientWidth > 0 ? iframeRect.width / iframe.clientWidth : state.canvasZoom;
        const scaleY =
          iframe.clientHeight > 0 ? iframeRect.height / iframe.clientHeight : state.canvasZoom;
        const anchorX = iframeRect.left - wrapperRect.left + clientX * scaleX;
        const anchorY = iframeRect.top - wrapperRect.top + clientY * scaleY;
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
    // Already loaded — the common case: a freshly promoted back buffer, or a
    // hot-reload remount. The initial front load instead lands in the slot's
    // own load handler.
    if (iframe.contentDocument?.readyState === "complete") channel.attach();
    return () => {
      channel.destroy();
      channelRef.current = null;
      clearNodeRects(frame.id);
    };
    // hasScreen: a frame added to an open board first mounts as the "Loading…"
    // placeholder (iframe null); re-run once the screen loads so the channel
    // actually attaches and the frame becomes selectable. iframeRef flips
    // between the two slot refs on every buffer swap, re-binding the channel
    // to the newly visible document.
  }, [
    frame.id,
    frame.screen,
    boardId,
    hasScreen,
    iframeRef,
    savedScrollRef,
    anchoredPathsRef,
    snippetPathsRef,
    setSelection,
    setHover,
    setNodeRects,
    setSelectionComputed,
    clearNodeRects,
  ]);

  return channelRef;
}

/**
 * Address a picked node the way markup should store it: by `@id` when the
 * node has one, since a numeric path goes stale as soon as a sibling is
 * added or moved.
 */
function nodeLocator(node: object, path: string): number[] | string {
  if ("$id" in node && node.$id) return `@${String(node.$id)}`;
  return path === "" ? [] : path.split(".").map(Number);
}
