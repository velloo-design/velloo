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
 * Owns its own draft state so typing isn't snapped back by store re-renders.
 * Re-keyed by selection identity by the parent. When `variantIds` has more
 * than one entry the same edit is replayed across each (sync mode).
 */
export function ClassesField({ initialValue, pageId, variantIds, path, debounceMs }: Props) {
  const [draft, setDraft] = useState(initialValue);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const onChange = (next: string) => {
    setDraft(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const parsedPath = pathFromString(path);
      for (const variantId of variantIds) {
        void mutate
          .applyClasses({ pageId, variantId, path: parsedPath, classes: next })
          .catch(() => undefined);
      }
    }, debounceMs);
  };

  return (
    <section className="flex flex-col gap-1">
      <label htmlFor="prop-className" className="text-xs font-medium text-[var(--color-fg-muted)]">
        classes
      </label>
      <textarea
        id="prop-className"
        value={draft}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        spellCheck={false}
        className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm font-mono"
      />
    </section>
  );
}
