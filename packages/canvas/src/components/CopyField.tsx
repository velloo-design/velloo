import { useEffect, useRef, useState } from "react";
import { mutate } from "../api.ts";
import { pathFromString } from "../path.ts";
import { Label } from "./ui/label.tsx";
import { Textarea } from "./ui/textarea.tsx";

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
    <section className="flex flex-col gap-1.5">
      <Label htmlFor="prop-children" className="text-xs font-medium text-muted-foreground">
        text
      </Label>
      <Textarea
        id="prop-children"
        value={draft}
        onChange={(e) => commit(e.target.value)}
        rows={2}
        className="min-h-0"
      />
    </section>
  );
}
