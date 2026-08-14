import { isComponentNode, isSnippetInstance, type Node, type Screen } from "@velloo/schema";
import { useState } from "react";
import { mutate, type SnippetMeta } from "../api.ts";
import { pathFromString } from "../path.ts";
import { type Selection, useCanvas } from "../store.ts";
import { toastError } from "../toast.ts";
import { SnippetPreviewDialog } from "./SnippetPreviewDialog.tsx";

/**
 * Walk the screen tree from the selection up toward the root and
 * return the first node path that can host a snippet — i.e., a
 * ComponentNode that's not a snippet instance. Falls back to `[]`
 * (root) on any failure.
 *
 * Snippet bodies are opaque — instantiate_snippet would 400 if we
 * tried to push the new instance inside one. Going up to the host
 * component preserves the user's intent ("under what I selected")
 * without the bad-request foot-gun.
 */
function chooseParentPath(
  screens: Record<string, Screen>,
  sel: Selection | null,
): number[] | string {
  if (!sel) return [];
  // Id locators are server-resolved; we trust them and pass through.
  if (sel.path.startsWith("@")) return sel.path;
  if (sel.path === "") return [];
  const screen = screens[sel.screenId];
  if (!screen) return [];
  const segments = pathFromString(sel.path);
  for (let depth = segments.length; depth >= 0; depth -= 1) {
    const candidate = segments.slice(0, depth);
    let node: Node | undefined = screen.tree;
    let ok = true;
    for (const i of candidate) {
      if (!node || !isComponentNode(node)) {
        ok = false;
        break;
      }
      node = node.children?.[i];
    }
    if (ok && node && isComponentNode(node) && !isSnippetInstance(node)) {
      return candidate;
    }
  }
  return [];
}

interface Props {
  snippets: SnippetMeta[];
}

/**
 * Grid of rendered snippet thumbnails. Click a thumbnail to open a
 * preview modal — the user sees a larger render + the param contract
 * before committing. Used to insert-on-click and the new node showed
 * up at the bottom of the tree with no preamble; users had to undo
 * to recover.
 *
 * Each thumb is a tiny iframe that fetches
 * `/api/render/snippet/<id>` — required params get friendly
 * placeholders server-side so the preview always renders.
 */
export function SnippetsBrowser({ snippets }: Props) {
  const currentScreenId = useCanvas((s) => s.currentScreenId);
  const selection = useCanvas((s) => s.selection);
  const screens = useCanvas((s) => s.screens);
  const screenVersion = useCanvas((s) => s.screenVersion);
  const themeVersion = useCanvas((s) => s.themeVersion);
  const [previewing, setPreviewing] = useState<SnippetMeta | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (snippets.length === 0) return null;

  // Computed for the preview dialog's "Insert under: …" hint.
  const localSelection = selection && selection.screenId === currentScreenId ? selection : null;
  const insertHint = !currentScreenId
    ? "(pick a screen first)"
    : !localSelection
      ? `${currentScreenId} · (root)`
      : `${currentScreenId} · ${localSelection.path === "" ? "(root)" : localSelection.path}`;

  const confirmInsert = async () => {
    const s = previewing;
    if (!s || !currentScreenId) {
      setPreviewing(null);
      return;
    }
    setBusyId(s.id);
    setPreviewing(null);
    try {
      const args: Record<string, unknown> = {};
      for (const p of s.params) {
        if (p.default !== undefined) continue;
        if (p.type === "string") args[p.name] = p.name;
        else if (p.type === "number") args[p.name] = 0;
        else if (p.type === "boolean") args[p.name] = false;
        else if (p.type === "node") args[p.name] = { $ref: "Text", props: { children: p.name } };
      }
      const parentPath = chooseParentPath(screens, localSelection);
      await mutate.instantiateSnippet({
        screenId: currentScreenId,
        parentPath,
        snippetId: s.id,
        ...(Object.keys(args).length > 0 ? { args } : {}),
      });
    } catch (err) {
      toastError(err, "Could not instantiate snippet");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <ul className="grid grid-cols-2 gap-1.5 px-2">
        {snippets.map((s) => {
          const paramLabel =
            s.params.length === 0
              ? "no params"
              : `${s.params.length} param${s.params.length === 1 ? "" : "s"}`;
          const title = `${s.name} — ${paramLabel}${
            s.params.length > 0 ? ` (${s.params.map((p) => p.name).join(", ")})` : ""
          }. Click to preview + insert.`;
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => setPreviewing(s)}
                disabled={!currentScreenId || busyId !== null}
                className="group relative flex w-full flex-col gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-1 text-left transition-all hover:border-[var(--color-accent)]/60 hover:bg-[var(--color-surface)] disabled:opacity-50 disabled:hover:border-[var(--color-border)]"
                title={title}
              >
                <div className="relative h-20 w-full overflow-hidden rounded bg-white">
                  <iframe
                    // The version cache-busts so theme/screen changes refresh thumbs.
                    src={`/api/render/snippet/${encodeURIComponent(s.id)}?w=320&h=120&v=${themeVersion}.${screenVersion}`}
                    title={`${s.name} preview`}
                    // Half-scale so a 320x120 render fits the 160x60 effective tile.
                    className="absolute top-0 left-0 origin-top-left pointer-events-none"
                    style={{ transform: "scale(0.5)", width: "320px", height: "240px" }}
                    loading="lazy"
                  />
                  {busyId === s.id ? (
                    <div className="absolute inset-0 grid place-items-center bg-[var(--color-bg)]/70 text-xs text-[var(--color-fg-muted)]">
                      …
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center justify-between gap-1 px-0.5">
                  <div className="truncate text-xs font-medium text-[var(--color-fg)]">
                    {s.name}
                  </div>
                  <div className="shrink-0 text-[9px] text-[var(--color-fg-muted)] tabular-nums">
                    {s.params.length || "—"}
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      <SnippetPreviewDialog
        open={previewing !== null}
        snippet={previewing}
        insertHint={insertHint}
        onConfirm={() => void confirmInsert()}
        onCancel={() => setPreviewing(null)}
      />
    </>
  );
}
