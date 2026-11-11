import { ChevronsUpDown, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "./ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.tsx";
import { Input } from "./ui/input.tsx";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./ui/input-group.tsx";
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "./ui/native-select.tsx";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group.tsx";

export interface PageOption {
  value: string;
  label: string;
  /** A second line: the source file, the captured URL. */
  detail?: string | undefined;
  /** The heading it is listed under ("Pages of the app"). */
  group?: string | undefined;
}

/** Past this many, the list is a dialog to search rather than a dropdown to scroll. */
const SEARCH_ABOVE = 5;

/**
 * Which page: picked from a list, or typed. An app with a few pages gets a
 * dropdown; one with dozens gets a dialog that filters as you type, since a
 * dropdown of sixty routes is a scroll, not a choice. Shared by the art
 * direction's start page and `velloo init`, so the two ask the same way.
 */
export function PageChooser({
  id,
  options,
  mode,
  onMode,
  value,
  onValue,
  typed,
  onTyped,
  typedPlaceholder,
  pickLabel = "Pick a page",
  typeLabel = "Type its name",
}: {
  id: string;
  options: PageOption[];
  mode: "pick" | "type";
  onMode(mode: "pick" | "type"): void;
  value: string | null;
  onValue(value: string): void;
  typed: string;
  onTyped(text: string): void;
  typedPlaceholder: string;
  pickLabel?: string;
  typeLabel?: string;
}) {
  const [searching, setSearching] = useState(false);
  const picked = options.find((o) => o.value === value);
  return (
    <div className="flex flex-col gap-2">
      {options.length > 0 ? (
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={mode}
          onValueChange={(next) => (next ? onMode(next as "pick" | "type") : null)}
          className="self-start"
          aria-label="How to name the page"
        >
          <ToggleGroupItem value="pick">{pickLabel}</ToggleGroupItem>
          <ToggleGroupItem value="type">{typeLabel}</ToggleGroupItem>
        </ToggleGroup>
      ) : null}
      {mode === "pick" && options.length > 0 ? (
        options.length > SEARCH_ABOVE ? (
          <>
            <Button
              id={id}
              type="button"
              variant="outline"
              className="justify-between font-normal"
              onClick={() => setSearching(true)}
            >
              <span className="flex min-w-0 items-baseline gap-2 truncate">
                {picked ? (
                  <>
                    <span className="truncate">{picked.label}</span>
                    {picked.detail ? (
                      <span className="truncate text-xs text-muted-foreground">
                        {picked.detail}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span className="text-muted-foreground">Choose one of {options.length}…</span>
                )}
              </span>
              <ChevronsUpDown className="opacity-60" />
            </Button>
            <SearchDialog
              open={searching}
              options={options}
              value={value}
              onClose={() => setSearching(false)}
              onPick={(next) => {
                onValue(next);
                setSearching(false);
              }}
            />
          </>
        ) : (
          <NativeSelect id={id} value={value ?? ""} onChange={(e) => onValue(e.target.value)}>
            {groupsOf(options).map(([group, items]) => {
              const rows = items.map((o) => (
                <NativeSelectOption key={o.value} value={o.value}>
                  {o.label}
                  {o.detail ? `  ·  ${o.detail}` : ""}
                </NativeSelectOption>
              ));
              return group ? (
                <NativeSelectOptGroup key={group} label={group}>
                  {rows}
                </NativeSelectOptGroup>
              ) : (
                rows
              );
            })}
          </NativeSelect>
        )
      ) : (
        <Input
          id={id}
          placeholder={typedPlaceholder}
          value={typed}
          onChange={(e) => onTyped(e.target.value)}
        />
      )}
    </div>
  );
}

function groupsOf(options: PageOption[]): [string, PageOption[]][] {
  const out = new Map<string, PageOption[]>();
  for (const o of options) out.set(o.group ?? "", [...(out.get(o.group ?? "") ?? []), o]);
  return [...out];
}

function SearchDialog({
  open,
  options,
  value,
  onClose,
  onPick,
}: {
  open: boolean;
  options: PageOption[];
  value: string | null;
  onClose(): void;
  onPick(value: string): void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return options.filter((o) => {
      const hay = `${o.label} ${o.detail ?? ""} ${o.group ?? ""}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [options, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(
        Math.max(
          0,
          options.findIndex((o) => o.value === value),
        ),
      );
    }
  }, [open, options, value]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new query starts at the top.
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="gap-3 p-4 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Which page?</DialogTitle>
          <DialogDescription className="sr-only">
            Type to filter the pages, then pick one.
          </DialogDescription>
        </DialogHeader>
        <InputGroup>
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls="page-chooser-list"
            aria-activedescendant={shown[active] ? `page-option-${active}` : undefined}
            placeholder="Search by path, name or file"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => Math.min(shown.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter" && shown[active]) {
                e.preventDefault();
                onPick(shown[active].value);
              }
            }}
          />
        </InputGroup>
        <div
          ref={list}
          id="page-chooser-list"
          role="listbox"
          aria-label="Pages"
          className="-mx-1 max-h-[50vh] overflow-y-auto"
        >
          {shown.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              No page matches “{query}”.
            </p>
          ) : (
            shown.map((o, i) => (
              <div
                key={o.value}
                id={`page-option-${i}`}
                data-index={i}
                role="option"
                aria-selected={i === active}
                tabIndex={-1}
                onMouseMove={() => setActive(i)}
                onClick={() => onPick(o.value)}
                onKeyDown={(e) => (e.key === "Enter" ? onPick(o.value) : null)}
                className={`flex cursor-pointer flex-col gap-0.5 rounded-md px-2 py-1.5 text-sm ${i === active ? "bg-muted" : ""}`}
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="truncate font-medium">{o.label}</span>
                  {o.group ? (
                    <span className="shrink-0 text-[11px] text-muted-foreground">{o.group}</span>
                  ) : null}
                </span>
                {o.detail ? (
                  <span className="truncate text-xs text-muted-foreground">{o.detail}</span>
                ) : null}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
