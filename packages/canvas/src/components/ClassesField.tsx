import { useEffect, useRef, useState } from "react";
import { mutate } from "../api.ts";
import { pathFromString } from "../path.ts";

interface Props {
  initialValue: string;
  screenId: string;
  path: string;
  debounceMs: number;
}

export function ClassesField({ initialValue, screenId, path, debounceMs }: Props) {
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
      void mutate
        .applyClasses({ screenId, path: pathFromString(path), classes: next })
        .catch(() => undefined);
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
