import * as Lucide from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.tsx";

interface Props {
  value: string;
  options: string[];
  onChange(name: string): void;
}

// Unavoidable cast: lucide's namespace has thousands of icon exports (forwardRef
// exotics, indistinguishable from helper exports at runtime) and no Record-typed index.
const LUCIDE = Lucide as unknown as Record<string, React.ComponentType<Lucide.LucideProps>>;

/**
 * Typeahead-over-grid icon picker. The input filters the lucide list
 * by substring; the grid below previews up to MAX hits and lets the
 * user click one to commit. The currently selected icon is rendered
 * next to the trigger.
 */
const MAX_VISIBLE = 80;

export function IconPicker({ value, options, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, MAX_VISIBLE);
    return options.filter((n) => n.toLowerCase().includes(q)).slice(0, MAX_VISIBLE);
  }, [options, query]);

  const Resolved = value ? LUCIDE[value] : undefined;

  return (
    <div className="flex items-center gap-2">
      <div className="grid h-8 w-8 place-items-center rounded-md border bg-background text-foreground shrink-0">
        {Resolved ? <Resolved size={16} strokeWidth={2} /> : <span className="text-xs">?</span>}
      </div>
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setQuery("");
          else requestAnimationFrame(() => inputRef.current?.focus());
        }}
      >
        <PopoverTrigger asChild>
          <Button variant="outline" size="default" className="flex-1 justify-start font-normal">
            {value || <span className="text-muted-foreground">Pick an icon…</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-0">
          <Input
            ref={inputRef}
            type="text"
            value={query}
            placeholder={`Search ${options.length} icons…`}
            onChange={(e) => setQuery(e.target.value)}
            className="rounded-b-none border-0 border-b shadow-none focus-visible:ring-0"
          />
          <div className="grid max-h-64 grid-cols-8 gap-1 overflow-auto p-2">
            {filtered.length === 0 ? (
              <div className="col-span-8 px-2 py-4 text-center text-xs text-muted-foreground">
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
                      setOpen(false);
                      setQuery("");
                    }}
                    className={
                      "grid h-7 w-7 place-items-center rounded-md transition-colors " +
                      (active
                        ? "bg-primary text-primary-foreground"
                        : "text-foreground hover:bg-muted")
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
        </PopoverContent>
      </Popover>
    </div>
  );
}
