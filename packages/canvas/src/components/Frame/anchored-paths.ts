import type { Frame as FrameT } from "@velloo/schema";
import { useMemo, useRef } from "react";
import { type CanvasState, useCanvas } from "../../store.ts";

/**
 * The node paths this frame's iframe must report rects for: everything
 * pinned to a node, plus the selection (and, while a snippet is focused, the
 * selected definition path). The refs mirror the lists for handlers bound
 * once per channel, which can't close over the current values.
 */
export function useAnchoredPaths(frame: FrameT) {
  const selection = useCanvas((s) => s.selection);
  const snippetFocus = useCanvas((s) => s.snippetFocus);
  const commentThreads = useCanvas((s) => s.commentThreads);
  const notes = useCanvas((s) => s.notes);
  const annotations = useCanvas((s) => s.annotations);

  // The selected node joins the anchored set: the HUD's resize handles are
  // parent-side chrome and need its box, which only the iframe can measure.
  const selectedPath = selection?.screenId === frame.screen ? selection.path : null;
  const anchoredPaths = useMemo(() => {
    const paths = anchoredNodePaths({ commentThreads, notes, annotations }, frame.id, frame.screen);
    if (selectedPath !== null && !paths.includes(selectedPath)) paths.push(selectedPath);
    return paths;
  }, [commentThreads, notes, annotations, frame.id, frame.screen, selectedPath]);
  // While a snippet is focused the selection addresses the definition, which is
  // a different namespace from the host tree's node paths — asking for it as a
  // node path measures nothing, which is why the grips never drew in that mode.
  const snippetSelectedPath =
    snippetFocus !== null && selection?.screenId === `snippet:${snippetFocus}`
      ? selection.path
      : null;
  const snippetPaths = useMemo(
    () => (snippetSelectedPath === null ? [] : [snippetSelectedPath]),
    [snippetSelectedPath],
  );
  const anchoredPathsRef = useRef(anchoredPaths);
  anchoredPathsRef.current = anchoredPaths;
  const snippetPathsRef = useRef(snippetPaths);
  snippetPathsRef.current = snippetPaths;

  return { anchoredPaths, snippetPaths, anchoredPathsRef, snippetPathsRef };
}

/**
 * Every node in a frame that something is pinned to. The iframe reports
 * these rects on request and comment pins, attached notes and annotation
 * connectors all anchor off the one registry, so they have to be asked
 * for together — a path missing here renders its markup unanchored.
 */
function anchoredNodePaths(
  s: Pick<CanvasState, "commentThreads" | "notes" | "annotations">,
  frameId: string,
  screenId: string,
): string[] {
  const paths = new Set<string>();
  for (const thread of s.commentThreads) {
    if (thread.anchor?.kind !== "node" || thread.anchor.frameId !== frameId) continue;
    if (thread.anchorState.status === "attached") {
      paths.add(thread.anchorState.resolvedPath.join("."));
    }
  }
  for (const note of s.notes) {
    if (note.attachment?.frameId === frameId && note.resolved) paths.add(note.resolved.join("."));
  }
  for (const annotation of s.annotations) {
    if (annotation.screenId === screenId && annotation.resolved) {
      paths.add(annotation.resolved.join("."));
    }
  }
  return [...paths];
}
