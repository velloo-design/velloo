import { ChevronDown, ChevronRight } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

interface CollapsibleSectionProps {
  /** Section heading text (rendered uppercase + tracking-wider). */
  title: string;
  /**
   * Stable storage key. The expanded/collapsed state persists across
   * sessions in localStorage so the user's panel layout sticks.
   */
  storageKey: string;
  /** Default expanded state on first render. Defaults to `true`. */
  defaultOpen?: boolean;
  children: ReactNode;
}

const STORAGE_PREFIX = "velloo:section:";

function readStored(key: string, defaultOpen: boolean): boolean {
  if (typeof localStorage === "undefined") return defaultOpen;
  const raw = localStorage.getItem(STORAGE_PREFIX + key);
  if (raw === "open") return true;
  if (raw === "closed") return false;
  return defaultOpen;
}

/**
 * Lightweight disclosure section. Heading + chevron, click to toggle.
 * Used in the theme panel so designers can fold presets/generate/colors
 * out of the way once they've found a vibe. Persisted per-section.
 */
export function CollapsibleSection({
  title,
  storageKey,
  defaultOpen = true,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState<boolean>(() => readStored(storageKey, defaultOpen));

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_PREFIX + storageKey, open ? "open" : "closed");
  }, [storageKey, open]);

  return (
    <section className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs uppercase tracking-wider text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] transition-colors text-left"
      >
        {open ? (
          <ChevronDown size={11} strokeWidth={2.5} />
        ) : (
          <ChevronRight size={11} strokeWidth={2.5} />
        )}
        <span>{title}</span>
      </button>
      {open ? <div className="flex flex-col gap-2">{children}</div> : null}
    </section>
  );
}
