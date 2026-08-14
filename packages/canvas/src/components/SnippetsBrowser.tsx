import { useState } from "react";
import { mutate, type SnippetMeta } from "../api.ts";
import { useCanvas } from "../store.ts";
import { toastError } from "../toast.ts";

interface Props {
  snippets: SnippetMeta[];
}

/**
 * Grid of rendered snippet thumbnails. Each thumb is a tiny iframe that
 * fetches `/api/render/snippet/<id>` — required params get friendly
 * placeholders server-side so the preview always renders.
 *
 * Click a thumbnail to instantiate the snippet under the current
 * selection (or at the screen root). Hovering a thumbnail surfaces the
 * param list as a tooltip so users can scan the contract without
 * opening the snippet inspector.
 */
export function SnippetsBrowser({ snippets }: Props) {
  const currentScreenId = useCanvas((s) => s.currentScreenId);
  const selection = useCanvas((s) => s.selection);
  const screenVersion = useCanvas((s) => s.screenVersion);
  const themeVersion = useCanvas((s) => s.themeVersion);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (snippets.length === 0) return null;

  const instantiate = async (s: SnippetMeta) => {
    if (!currentScreenId) return;
    setBusyId(s.id);
    try {
      const args: Record<string, unknown> = {};
      for (const p of s.params) {
        if (p.default !== undefined) continue;
        if (p.type === "string") args[p.name] = p.name;
        else if (p.type === "number") args[p.name] = 0;
        else if (p.type === "boolean") args[p.name] = false;
        else if (p.type === "node") args[p.name] = { $ref: "Text", props: { children: p.name } };
      }
      await mutate.instantiateSnippet({
        screenId: currentScreenId,
        parentPath: selection?.path ? selection.path.split(".").filter(Boolean).map(Number) : [],
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
    <ul className="grid grid-cols-2 gap-1.5 px-2">
      {snippets.map((s) => {
        const paramLabel =
          s.params.length === 0
            ? "no params"
            : `${s.params.length} param${s.params.length === 1 ? "" : "s"}`;
        const title = `${s.name} — ${paramLabel}${
          s.params.length > 0 ? ` (${s.params.map((p) => p.name).join(", ")})` : ""
        }. Click to instantiate.`;
        return (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => instantiate(s)}
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
                <div className="truncate text-xs font-medium text-[var(--color-fg)]">{s.name}</div>
                <div className="shrink-0 text-[9px] text-[var(--color-fg-muted)] tabular-nums">
                  {s.params.length || "—"}
                </div>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
