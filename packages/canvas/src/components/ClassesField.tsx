import { useEffect, useRef, useState } from "react";
import { mutate } from "../api.ts";
import { pathFromString } from "../path.ts";

interface Props {
  initialValue: string;
  pageId: string;
  variantId: string;
  path: string;
  debounceMs: number;
}

/**
 * Owns its own draft state so typing isn't snapped back by store re-renders.
 * The parent re-keys this on selection change so a new node starts fresh.
 */
export function ClassesField({ initialValue, pageId, variantId, path, debounceMs }: Props) {
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
      void mutate.applyClasses({
        pageId,
        variantId,
        path: pathFromString(path),
        classes: next,
      });
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
