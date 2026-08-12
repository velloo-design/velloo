import * as Lucide from "lucide-react";
import { useMemo, useRef, useState } from "react";

interface Props {
  value: string;
  options: string[];
  onChange(name: string): void;
}

const LUCIDE = Lucide as unknown as Record<string, React.ComponentType<Lucide.LucideProps>>;

/**
 * Typeahead-over-grid icon picker. The input filters the lucide list by
 * substring; the grid below previews up to MAX hits and lets the user click
 * one to commit. The currently selected icon is rendered next to the input.
 */
const MAX_VISIBLE = 80;

export function IconPicker({ value, options, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, MAX_VISIBLE);
    return options.filter((n) => n.toLowerCase().includes(q)).slice(0, MAX_VISIBLE);
  }, [options, query]);

  const Resolved = value ? LUCIDE[value] : undefined;

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={rootRef} className="relative flex items-center gap-2">
      <div className="grid h-8 w-8 place-items-center rounded border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-fg)]">
        {Resolved ? <Resolved size={16} strokeWidth={2} /> : <span className="text-xs">?</span>}
      </div>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        className="flex-1 truncate rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-left text-sm hover:bg-[var(--color-surface)]"
        title="Pick an icon"
      >
        {value || <span className="text-[var(--color-fg-muted)]">Pick an icon…</span>}
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Close icon picker"
            onClick={close}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div className="absolute right-0 top-9 z-50 w-72 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] shadow-md">
            <input
              ref={inputRef}
              type="text"
              value={query}
              placeholder={`Search ${options.length} icons…`}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full rounded-t-md border-b border-[var(--color-border)] bg-transparent px-3 py-2 text-sm outline-none"
            />
            <div className="grid max-h-64 grid-cols-8 gap-1 overflow-auto p-2">
              {filtered.length === 0 ? (
                <div className="col-span-8 px-2 py-4 text-center text-xs text-[var(--color-fg-muted)]">
                  No matches.
                </div>
              ) : (
                filtered.map((name) => {
                  const Icon = LUCIDE[name];
                  if (!Icon) return null;
                  const active = name === value;
                  return (
                    <button
                      key={name}
                      type="button"
                      title={name}
                      onClick={() => {
                        onChange(name);
                        close();
                      }}
                      className={
                        "grid h-7 w-7 place-items-center rounded text-[var(--color-fg)] " +
                        (active
                          ? "bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
                          : "hover:bg-[var(--color-bg)]")
                      }
                    >
                      <Icon size={14} strokeWidth={2} />
                    </button>
                  );
                })
              )}
            </div>
            {query && filtered.length === MAX_VISIBLE ? (
              <div className="border-t border-[var(--color-border)] px-3 py-1 text-[10px] text-[var(--color-fg-muted)]">
                Showing first {MAX_VISIBLE}. Refine your search to see more.
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
