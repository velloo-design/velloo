import { useEffect, useMemo, useRef, useState } from "react";
import { resolveGlyph, useLucideGlyphs } from "./lucide-glyphs.ts";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.tsx";

interface Props {
  value: string;
  options: string[];
  onChange(name: string): void;
}

/**
 * Typeahead-over-grid icon picker. The input filters the lucide list
 * by substring; the grid below previews up to MAX hits and lets the
 * user click one to commit. The currently selected icon is rendered
 * next to the trigger.
 */
const MAX_VISIBLE = 80;

export function IconPicker({ value, options, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const glyphs = useLucideGlyphs();
  const Resolved = resolveGlyph(glyphs, value);

  return (
    <div className="flex items-center gap-2">
      <div className="grid h-8 w-8 place-items-center rounded-md border bg-background text-foreground shrink-0">
        {Resolved ? <Resolved size={16} strokeWidth={2} /> : <span className="text-xs">?</span>}
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="default" className="flex-1 justify-start font-normal">
            {value || <span className="text-muted-foreground">Pick an icon…</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-0">
          <IconGrid
            value={value}
            options={options}
            onPick={(name) => {
              onChange(name);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

/**
 * Search box over a glyph grid. Shared by the side pane's picker and the bar's
 * compact field, so the two can't drift on filtering or the visible cap.
 */
export function IconGrid({
  value,
  options,
  onPick,
}: {
  value: string;
  options: string[];
  onPick(name: string): void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const glyphs = useLucideGlyphs();

  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, MAX_VISIBLE);
    return options.filter((n) => n.toLowerCase().includes(q)).slice(0, MAX_VISIBLE);
  }, [options, query]);

  return (
    <>
      <Input
        ref={inputRef}
        type="text"
        value={query}
        placeholder={`Search ${options.length} icons…`}
        onChange={(e) => setQuery(e.target.value)}
        className="rounded-b-none border-0 border-b shadow-none focus-visible:ring-0"
      />
      <div className="grid max-h-64 grid-cols-8 gap-1 overflow-auto scroll-stable p-2">
        {filtered.length === 0 ? (
          <div className="col-span-8 px-2 py-4 text-center text-xs text-muted-foreground">
            No matches.
          </div>
        ) : (
          filtered.map((name) => {
            const Icon = resolveGlyph(glyphs, name);
            if (!Icon) return null;
            const active = name === value;
            return (
              <button
                key={name}
                type="button"
                title={name}
                onClick={() => onPick(name)}
                className={
                  "grid h-7 w-7 place-items-center rounded-md transition-colors " +
                  (active ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted")
                }
              >
                <Icon size={14} strokeWidth={2} />
              </button>
            );
          })
        )}
      </div>
      {query && filtered.length === MAX_VISIBLE ? (
        <div className="border-t px-3 py-1 text-[10px] text-muted-foreground">
          Showing first {MAX_VISIBLE}. Refine your search to see more.
        </div>
      ) : null}
    </>
  );
}
