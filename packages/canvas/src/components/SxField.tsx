import { useEffect, useRef, useState } from "react";
import { mutate } from "../api.ts";
import { pathFromString } from "../path.ts";
import { Label } from "./ui/label.tsx";
import { Textarea } from "./ui/textarea.tsx";

interface Props {
  /** The node's current object-style payload (sx / style), or undefined. */
  initialValue: Record<string, unknown> | undefined;
  /** The channel's prop name — "sx" (MUI) or "style". */
  prop: string;
  /** Label, e.g. "sx props". */
  label: string;
  screenId: string;
  path: string;
  debounceMs: number;
}

function format(v: Record<string, unknown> | undefined): string {
  return v && Object.keys(v).length > 0 ? JSON.stringify(v, null, 2) : "";
}

/**
 * The framework-native object-style editor (MUI `sx`, no-framework `style`) —
 * the inspector shows this instead of the Tailwind class field when the active
 * library's `StyleChannel` is object-shaped. A validated JSON textarea: a valid
 * object commits via `update_props { [prop]: object }`; empty clears it; invalid
 * JSON is flagged and not saved.
 */
export function SxField({ initialValue, prop, label, screenId, path, debounceMs }: Props) {
  const [draft, setDraft] = useState(() => format(initialValue));
  const [invalid, setInvalid] = useState(false);
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
      const trimmed = next.trim();
      let value: unknown;
      if (trimmed === "") {
        value = null; // clears the prop
      } else {
        try {
          const parsed = JSON.parse(trimmed);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            setInvalid(true);
            return;
          }
          value = parsed;
        } catch {
          setInvalid(true);
          return;
        }
      }
      setInvalid(false);
      void mutate
        .updateProps({ screenId, path: pathFromString(path), propPatch: { [prop]: value } })
        .catch(() => undefined);
    }, debounceMs);
  };

  return (
    <section className="flex flex-col gap-1.5">
      <Label htmlFor="prop-sx" className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      <Textarea
        id="prop-sx"
        value={draft}
        onChange={(e) => onChange(e.target.value)}
        rows={6}
        spellCheck={false}
        placeholder={'{ "p": 2, "display": "flex" }'}
        className={`min-h-0 font-mono${invalid ? " border-destructive" : ""}`}
      />
      {invalid && <p className="text-xs text-destructive">Invalid JSON — not saved.</p>}
    </section>
  );
}
