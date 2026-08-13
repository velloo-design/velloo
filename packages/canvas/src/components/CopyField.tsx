import { useEffect, useRef, useState } from "react";
import { mutate } from "../api.ts";
import { pathFromString } from "../path.ts";

interface Props {
  initialValue: string;
  screenId: string;
  path: string;
  debounceMs: number;
}

export function CopyField({ initialValue, screenId, path, debounceMs }: Props) {
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
      const value = next === "" ? null : next;
      void mutate
        .updateProps({
          screenId,
          path: pathFromString(path),
          propPatch: { children: value },
        })
        .catch(() => undefined);
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
