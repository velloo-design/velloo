import { useEffect, useRef, useState } from "react";
import { theme as themeApi } from "../api.ts";

interface Props {
  label: string;
  /** Dot-path of the theme color (e.g. "colors.primary.DEFAULT"). */
  tokenPath: string;
  /** Current value from the theme (kept in store-controlled prop). */
  value: string;
}

const DEBOUNCE_MS = 250;

/**
 * One color slot. Swatch tile + text field. Edits debounce, then POST
 * to /api/theme/set_token. The WS broadcast refreshes the iframes.
 */
export function ColorSwatch({ label, tokenPath, value }: Props) {
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync from prop when an external change (preset switch, vibe match) updates value.
  useEffect(() => {
    setDraft(value);
  }, [value]);

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
      void themeApi.setToken(tokenPath, next).catch(() => undefined);
    }, DEBOUNCE_MS);
  };

  return (
    <div className="flex items-center gap-2">
      <div
        className="h-7 w-7 rounded border border-[var(--color-border)] shrink-0"
        style={{ background: draft }}
        title={tokenPath}
      />
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <label
          htmlFor={`token-${tokenPath}`}
          className="text-xs text-[var(--color-fg-muted)] truncate"
        >
          {label}
        </label>
        <input
          id={`token-${tokenPath}`}
          type="text"
          value={draft}
          onChange={(e) => commit(e.target.value)}
          spellCheck={false}
          className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs font-mono"
        />
      </div>
    </div>
  );
}
