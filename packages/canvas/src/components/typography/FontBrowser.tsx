import {
  type CatalogFont,
  FONT_CATALOG,
  type FontCategory,
  type FontRole,
  fontStack,
} from "@velloo/schema/fonts";
import { ArrowLeft, Check, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { requestPreviewFace } from "../../font-preview.ts";
import { useCanvas } from "../../store.ts";
import { Input } from "../ui/input.tsx";

interface Props {
  /** The role being filled. Shown in the header so the drill-down has a subject. */
  role: string;
  /** Family currently on that role, ticked in the list. */
  current: string | undefined;
  onPick: (font: CatalogFont) => void;
  onBack: () => void;
}

/**
 * Shape filters, plus `suited` — the families this particular role wants.
 *
 * Those are different axes and conflating them hides things: Fraunces is a
 * serif by letterform and the best display face in the list, so a "Display"
 * category chip would filter it out of exactly the search it was made for.
 * Shape chips stay shape-only, and purpose gets its own.
 */
type Filter = FontCategory | "all" | "suited";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "suited", label: "Suited" },
  { id: "all", label: "All" },
  { id: "sans", label: "Sans" },
  { id: "serif", label: "Serif" },
  { id: "mono", label: "Mono" },
];

/**
 * What a role is probably for, read off its name. Roles are free-form, so this
 * only has to be right often enough to open the browser on a useful shortlist —
 * "All" is one click away when it guesses wrong.
 */
function roleIntent(role: string): FontRole {
  if (/^(mono|code)/.test(role)) return "mono";
  if (/(display|heading|title|wordmark|marquee|hero)/.test(role)) return "display";
  return "body";
}

/** Families listing the wanted role first are the ones drawn for it. */
function rank(font: CatalogFont, intent: FontRole): number {
  const at = font.roles.indexOf(intent);
  return at === -1 ? font.roles.length + 1 : at;
}

/**
 * Browse the curated families and put one on a role.
 *
 * It takes over the rail rather than opening a dialog on purpose: the useful
 * preview is the board re-facing behind it, and a centred modal would dim and
 * cover the only thing worth looking at. Highlighting a row — by pointer or by
 * keyboard focus — paints that family across every frame; only a click writes
 * it to the theme.
 */
export function FontBrowser({ role, current, onPick, onBack }: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("suited");
  const setFontDraft = useCanvas((s) => s.setFontDraft);
  const intent = roleIntent(role);

  useEffect(() => () => setFontDraft(null), [setFontDraft]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const scoped = FONT_CATALOG.filter((f) => {
      // Naming a family outranks the shortlist: searching "Fraunces" while the
      // role wants a mono face should find it and say so by the empty filter,
      // not report that the catalogue hasn't got it.
      if (q && f.family.toLowerCase().includes(q)) return true;
      if (filter === "suited") return f.roles.includes(intent);
      if (filter !== "all") return f.category === filter;
      return true;
    });
    // Best fit first whatever the filter, so the shortlist for the role being
    // filled is at the top rather than buried alphabetically.
    const ranked = [...scoped].sort((a, b) => rank(a, intent) - rank(b, intent));
    if (!q) return ranked;
    return ranked.filter((f) => `${f.family} ${f.note} ${f.category}`.toLowerCase().includes(q));
  }, [query, filter, intent]);

  const preview = (font: CatalogFont) => {
    setFontDraft({
      role,
      family: font.family,
      stack: fontStack(font),
      ...(font.google ? { google: font.google } : {}),
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-2 border-b p-3">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to theme"
            className="size-6 shrink-0 grid place-items-center rounded-md text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <ArrowLeft size={14} />
          </button>
          <span className="text-xs text-muted-foreground">
            Face for <span className="font-mono text-foreground">{role}</span>
          </span>
        </div>
        <div className="relative">
          <Search
            size={13}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground/60"
          />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${FONT_CATALOG.length} families`}
            spellCheck={false}
            aria-label="Search families"
            className="h-7 pl-7 text-xs"
          />
        </div>
        <div className="flex items-center gap-0.5 rounded-md bg-muted p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
              className={
                "flex-1 h-6 rounded-[5px] text-[11px] cursor-pointer " +
                (filter === f.id
                  ? "bg-background font-medium text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* The preview holds until another row replaces it or the browser closes.
          Dropping it the moment the pointer left the list would snap the board
          back every time you reached for the search box. */}
      <div className="flex-1 overflow-y-auto scroll-stable">
        {matches.length === 0 ? (
          <p className="p-4 text-xs text-muted-foreground">
            {query.trim() ? `No family here matches "${query.trim()}".` : "Nothing in this filter."}
            {filter === "suited" ? " Try All." : ""}
          </p>
        ) : (
          matches.map((font) => (
            <FontRow
              key={font.family}
              font={font}
              picked={font.family === current}
              onPreview={() => preview(font)}
              onPick={() => onPick(font)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function FontRow({
  font,
  picked,
  onPreview,
  onPick,
}: {
  font: CatalogFont;
  picked: boolean;
  onPreview: () => void;
  onPick: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);

  // Fetch the row's own face only once it can actually be seen. Mounting all
  // eighty at once would fire eighty requests for rows most sessions scroll
  // straight past.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          requestPreviewFace(font.family, font.google);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [font]);

  return (
    <button
      ref={ref}
      type="button"
      onClick={onPick}
      onMouseEnter={onPreview}
      onFocus={onPreview}
      className="flex w-full items-center gap-2 border-b px-3 py-2 text-left hover:bg-accent/50 focus-visible:bg-accent/50 outline-none cursor-pointer"
    >
      <span className="min-w-0 flex-1">
        <span
          className="block truncate text-[15px] leading-tight text-foreground"
          style={{ fontFamily: fontStack(font) }}
        >
          {font.family}
        </span>
        <span className="mt-0.5 block truncate text-[10px] text-muted-foreground/80">
          {font.note}
        </span>
      </span>
      {picked ? <Check size={13} className="shrink-0 text-primary" /> : null}
    </button>
  );
}
