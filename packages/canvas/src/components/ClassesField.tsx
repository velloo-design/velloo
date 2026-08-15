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
    <section className="flex flex-col gap-1.5">
      <Label htmlFor="prop-className" className="text-xs font-medium text-muted-foreground">
        classes
      </Label>
      <Textarea
        id="prop-className"
        value={draft}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        spellCheck={false}
        className="min-h-0 font-mono"
      />
    </section>
  );
}
