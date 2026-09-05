/**
 * Committing a control's value, shared by the bar and the side pane.
 *
 * Both surfaces render the same controls against the same node, so they must
 * write identically — including the replay below, which is subtle enough that
 * a second copy would drift.
 */

import type { Node } from "@velloo/schema";
import { useCallback, useRef } from "react";
import { mutate } from "../api.ts";
import { useEditCommit } from "../hooks/useEditCommit.ts";
import { pathFromString } from "../path.ts";
import type { Selection } from "../store/types.ts";
import { toastError } from "../toast.ts";
import type { ControlSpec, StyleKey } from "./control-set.ts";
import { applyStyleValue, blockifyForAlign } from "./values.ts";

const DEBOUNCE_MS = 200;

export type ControlInput = string | number | boolean | null;

export interface WriteOptions {
  selection: Selection | null;
  /** The node's current class string, straight from the store. */
  liveClasses: string;
  /** The selected node — some slots need the element, not just its classes. */
  node: Node | null;
}

/**
 * The drag a write belongs to, if any. A scrub writes continuously so the
 * design under the cursor is really the design — Tailwind's arbitrary values
 * only exist once the server has compiled them, so there's no faking it
 * locally — and naming the gesture is what keeps all those writes worth a
 * single undo.
 */
export interface WriteContext {
  gesture?: string | undefined;
}

export function useControlWrite({ selection, liveClasses, node }: WriteOptions) {
  const selectionKey = selection ? `${selection.screenId}:${selection.path}` : "";
  // Edits outrun the round trip — a scrub fires dozens of times inside one
  // debounce window, and the debounce only carries the last payload. So the
  // slots touched since this node was selected are replayed onto whatever the
  // store currently holds. Each write is an absolute value for one slot, which
  // makes the replay idempotent: once the store catches up, re-applying them
  // changes nothing.
  const touched = useRef<{ key: string; slots: [StyleKey, ControlInput][] } | null>(null);

  const pushClasses = useEditCommit<{
    screenId: string;
    path: string;
    classes: string;
    gesture?: string | undefined;
  }>(DEBOUNCE_MS, (p) => {
    void mutate
      .applyClasses({
        screenId: p.screenId,
        path: pathFromString(p.path),
        classes: p.classes,
        gesture: p.gesture,
      })
      .catch((err) => toastError(err, "Could not update style"));
  });

  const pushProps = useEditCommit<{
    screenId: string;
    path: string;
    patch: Record<string, unknown>;
    gesture?: string | undefined;
  }>(DEBOUNCE_MS, (p) => {
    void mutate
      .updateProps({
        screenId: p.screenId,
        path: pathFromString(p.path),
        propPatch: p.patch,
        gesture: p.gesture,
      })
      .catch((err) => toastError(err, "Could not update prop"));
  });

  const pushArgs = useEditCommit<{
    screenId: string;
    path: string;
    patch: Record<string, unknown>;
    gesture?: string | undefined;
  }>(DEBOUNCE_MS, (p) => {
    void mutate
      .updateSnippetArgs({
        screenId: p.screenId,
        path: pathFromString(p.path),
        argPatch: p.patch,
        gesture: p.gesture,
      })
      .catch((err) => toastError(err, "Could not update snippet"));
  });

  return useCallback(
    (spec: ControlSpec, value: ControlInput, ctx: WriteContext = {}) => {
      if (!selection) return;
      const { screenId, path } = selection;
      const { gesture } = ctx;
      const live = gesture !== undefined;
      if (spec.slot.via === "prop") {
        pushProps({ screenId, path, patch: { [spec.slot.name]: value }, gesture }, live);
        return;
      }
      if (spec.slot.via === "arg") {
        pushArgs({ screenId, path, patch: { [spec.slot.name]: value }, gesture }, live);
        return;
      }
      const key = spec.slot.key;
      const prior = touched.current?.key === selectionKey ? touched.current.slots : [];
      const slots: [StyleKey, ControlInput][] = [
        ...prior.filter(([k]) => k !== key),
        [key, typeof value === "boolean" ? String(value) : value],
      ];
      touched.current = { key: selectionKey, slots };
      let classes = liveClasses;
      for (const [k, v] of slots) {
        classes = applyStyleValue(classes, k, typeof v === "boolean" ? String(v) : v);
      }
      if (key === "textAlign" && value !== null && node) classes = blockifyForAlign(classes, node);
      pushClasses({ screenId, path, classes, gesture }, live);
    },
    [selection, selectionKey, liveClasses, node, pushClasses, pushProps, pushArgs],
  );
}
