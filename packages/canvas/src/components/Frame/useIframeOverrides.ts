import { type RefObject, useEffect, useRef } from "react";
import { fontDraftCss, fontDraftUrl } from "../../font-draft.ts";
import { useCanvas } from "../../store.ts";
import { typesetDraftCss } from "../../typeset-draft.ts";

interface Options {
  slotRefs: readonly [RefObject<HTMLIFrameElement | null>, RefObject<HTMLIFrameElement | null>];
  front: 0 | 1;
  screenRev: number;
  hasScreen: boolean;
  /** The visible buffer shows the current src — no reload in flight. */
  frontIsCurrent: boolean;
}

/**
 * Styles the canvas writes straight into both buffers' documents — they're
 * same-origin, and parent CSS can't reach cross-document content. Re-applied
 * after every buffer swap and reload, since a fresh document starts without.
 */
export function useIframeOverrides({
  slotRefs,
  front,
  screenRev,
  hasScreen,
  frontIsCurrent,
}: Options): void {
  const cursorMode = useCanvas((s) => s.cursorMode);
  const typesetDraft = useCanvas((s) => s.typesetDraft);
  const fontDraft = useCanvas((s) => s.fontDraft);
  const [slotA, slotB] = slotRefs;

  // Comment and note mode need a pick-target cursor *inside* the iframe.
  // biome-ignore lint/correctness/useExhaustiveDependencies: front/screenRev/hasScreen re-apply the style after iframe swaps/reloads
  useEffect(() => {
    const apply = (iframe: HTMLIFrameElement | null) => {
      const doc = iframe?.contentDocument;
      if (!doc?.head) return;
      const id = "__velloo-comment-cursor";
      let el = doc.getElementById(id);
      // Match the parent-document cursor for each mode so the reticle
      // doesn't change as the pointer crosses into a frame.
      const cursor = cursorMode === "comment" ? "cell" : cursorMode === "note" ? "crosshair" : null;
      if (cursor) {
        if (!el) {
          el = doc.createElement("style");
          el.id = id;
          doc.head.appendChild(el);
        }
        el.textContent = `*, *::before, *::after { cursor: ${cursor} !important; }`;
      } else if (el) {
        el.remove();
      }
    };
    apply(slotA.current);
    apply(slotB.current);
  }, [cursorMode, front, screenRev, hasScreen]);

  // Live theme preview: while a rhythm control is being dragged or a family is
  // highlighted in the font browser, paint the uncommitted values straight into
  // this frame's document as CSS-variable overrides. Same-origin, so it's a
  // direct style write rather than a channel message, and both the type ladder
  // and the font roles re-derive from those variables — the board re-rhythms or
  // re-faces continuously with no reload and no render.
  //
  // The override outlives the store draft by one document. A commit clears the
  // draft and bumps `themeVersion` in the same tick, and the reloaded document
  // takes a moment to arrive; dropping the override immediately would snap this
  // frame back to the pre-edit theme for exactly that long. So it is held while
  // a reload is in flight and released once the current document — which the
  // server rendered with the committed values — is the one on screen.
  const heldDraftRef = useRef<{ css: string; fontUrl: string | null } | null>(null);
  if (typesetDraft || fontDraft) {
    const css = [
      typesetDraft ? typesetDraftCss(typesetDraft) : "",
      fontDraft ? fontDraftCss(fontDraft) : "",
    ]
      .filter(Boolean)
      .join("\n");
    heldDraftRef.current = { css, fontUrl: fontDraft ? fontDraftUrl(fontDraft) : null };
  } else if (frontIsCurrent) {
    heldDraftRef.current = null;
  }
  const draft = heldDraftRef.current;
  const draftCss = draft?.css ?? "";
  const draftFontUrl = draft?.fontUrl ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: front/screenRev/hasScreen re-apply the override after iframe swaps and reloads
  useEffect(() => {
    const apply = (iframe: HTMLIFrameElement | null) => {
      const doc = iframe?.contentDocument;
      if (!doc?.head) return;
      // The webfont link goes in first: the override naming the family is inert
      // until the face is actually being fetched.
      upsertHeadElement(doc, "__velloo-font-draft", "link", draftFontUrl, (el) => {
        const link = el as HTMLLinkElement;
        link.rel = "stylesheet";
        link.href = draftFontUrl as string;
      });
      upsertHeadElement(doc, "__velloo-theme-draft", "style", draftCss || null, (el) => {
        el.textContent = draftCss;
      });
    };
    apply(slotA.current);
    apply(slotB.current);
  }, [draftCss, draftFontUrl, front, screenRev, hasScreen]);
}

/**
 * Add, update or drop one identified element in an iframe's `<head>`.
 *
 * Preview overrides are written into a document the canvas doesn't own and
 * re-applied after every buffer swap, so each one has to be idempotent and
 * removable by id rather than tracked in React state.
 */
function upsertHeadElement(
  doc: Document,
  id: string,
  tag: "style" | "link",
  wanted: string | null,
  configure: (el: HTMLElement) => void,
): void {
  const existing = doc.getElementById(id);
  if (wanted === null) {
    existing?.remove();
    return;
  }
  const el = existing ?? doc.createElement(tag);
  if (!existing) {
    el.id = id;
    doc.head.appendChild(el);
  }
  configure(el as HTMLElement);
}
