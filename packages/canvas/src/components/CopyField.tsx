import { useEffect, useRef, useState } from "react";
import { mutate } from "../api.ts";
import { pathFromString } from "../path.ts";

interface Props {
  initialValue: string;
  pageId: string;
  variantIds: string[];
  path: string;
  debounceMs: number;
}

/**
 * Editable copy for nodes whose `children` is a string. Mirrors local state
 * so typing isn't snapped back by store-driven re-renders. When `variantIds`
 * has more than one entry the same edit is replayed across each — that's how
 * "Sync across variants" works.
 */
export function CopyField({ initialValue, pageId, variantIds, path, debounceMs }: Props) {
  const [draft, setDraft] = useState(initialValue);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const commit = (next: string) => {
    setDraft(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const parsedPath = pathFromString(path);
      const value = next === "" ? null : next;
      for (const variantId of variantIds) {
        void mutate
          .updateProps({
            pageId,
            variantId,
            path: parsedPath,
            propPatch: { children: value },
          })
          .catch(() => undefined);
      }
    }, debounceMs);
  };

  return (
    <section className="flex flex-col gap-1">
      <label htmlFor="prop-children" className="text-xs font-medium text-[var(--color-fg-muted)]">
        text
      </label>
      <textarea
        id="prop-children"
        value={draft}
        onChange={(e) => commit(e.target.value)}
        rows={2}
        className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm"
      />
    </section>
  );
}
