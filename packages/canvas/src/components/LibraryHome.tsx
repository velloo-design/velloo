import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { SnippetMeta } from "../api.ts";
import { LIBRARY_CATEGORIES } from "../library-categories.ts";
import { type LibraryItemRef, useCanvas } from "../store.ts";

interface Props {
  snippets: SnippetMeta[];
}

interface Tile {
  ref: LibraryItemRef;
  label: string;
  category: string;
  isSnippet: boolean;
  previewHeight: number;
}

const COMPONENT_TILE_HEIGHTS: Record<string, number> = {
  Button: 110,
  Badge: 110,
  Heading: 90,
  Text: 80,
  Label: 80,
  Input: 100,
  Textarea: 130,
  Switch: 100,
  Checkbox: 100,
  Slider: 100,
  Progress: 100,
  Skeleton: 80,
  Separator: 80,
  Divider: 80,
  Toggle: 100,
  Calendar: 280,
  Icon: 110,
  Placeholder: 150,
  Avatar: 110,
  Alert: 140,
  Card: 130,
  Tabs: 110,
  Breadcrumb: 80,
  Pagination: 100,
  Accordion: 150,
  RadioGroup: 100,
  ToggleGroup: 100,
  Select: 100,
  Toast: 140,
  Gradient: 130,
};

function heightFor(componentId: string): number {
  return COMPONENT_TILE_HEIGHTS[componentId] ?? 120;
}

/**
 * Library landing page. Masonry of every component + snippet, with a
 * sticky search/filter band on top. Title scrolls away; chips stay
 * pinned so the user can re-filter without scrolling back up.
 *
 * Tile previews are iframes pointing at the server's render routes —
 * same path the SnippetsBrowser thumbnails use, so we get free
 * theme/dark-mode flipping and live updates when the design folder
 * changes.
 */
export function LibraryHome({ snippets }: Props) {
  const components = useCanvas((s) => s.components);
  const openLibrary = useCanvas((s) => s.openLibrary);
  const themeVersion = useCanvas((s) => s.themeVersion);
  const designMode = useCanvas((s) => s.designMode);

  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const availableComponentIds = useMemo(() => {
    const set = new Set<string>();
    if (components) for (const c of components) set.add(c.id);
    return set;
  }, [components]);

  const allTiles: Tile[] = useMemo(() => {
    const out: Tile[] = [];
    for (const cat of LIBRARY_CATEGORIES) {
      for (const id of cat.components) {
        if (availableComponentIds.size > 0 && !availableComponentIds.has(id)) continue;
        out.push({
          ref: { kind: "component", id },
          label: id,
          category: cat.label,
          isSnippet: false,
          previewHeight: heightFor(id),
        });
      }
    }
    for (const s of snippets) {
      out.push({
        ref: { kind: "snippet", id: s.id },
        label: s.name,
        category: "Snippets",
        isSnippet: true,
        // Snippets are usually richer than a single component — taller previews.
        previewHeight: 150,
      });
    }
    return out;
  }, [availableComponentIds, snippets]);

  const componentCount = allTiles.filter((t) => !t.isSnippet).length;
  const snippetCount = allTiles.filter((t) => t.isSnippet).length;

  const q = query.trim().toLowerCase();
  const matches = (s: string) => !q || s.toLowerCase().includes(q);
  const filtered = allTiles.filter((t) => {
    if (activeCategory && t.category !== activeCategory) return false;
    if (!matches(t.label)) return false;
    return true;
  });

  // Split into 3 roughly-equal columns by running height so the masonry
  // doesn't get top-heavy.
  const COLS = 3;
  const columns: Tile[][] = Array.from({ length: COLS }, () => []);
  const heights: number[] = Array.from({ length: COLS }, () => 0);
  for (const t of filtered) {
    let target = 0;
    let min = heights[0] ?? 0;
    for (let i = 1; i < COLS; i += 1) {
      const h = heights[i] ?? 0;
      if (h < min) {
        target = i;
        min = h;
      }
    }
    columns[target]?.push(t);
    heights[target] = (heights[target] ?? 0) + t.previewHeight + 60;
  }

  const dark = designMode === "dark";
  const previewMode = dark ? "&mode=dark" : "";

  return (
    <div className="flex-1 overflow-auto bg-[var(--color-bg)]">
      <div className="mx-auto w-full max-w-6xl flex flex-col">
        <header className="px-8 pt-10 pb-5">
          <div className="flex items-baseline gap-3">
            <h1 className="text-3xl font-semibold tracking-tight text-[var(--color-fg)]">
              Library
            </h1>
            <span className="text-sm text-[var(--color-fg-muted)]">
              {componentCount} components · {snippetCount} snippets
            </span>
          </div>
          <p className="mt-1 text-sm text-[var(--color-fg-muted)] max-w-2xl">
            Everything you can drop onto a board. Click a tile to see variants and props.
          </p>
        </header>

        <div className="sticky top-0 z-20 bg-[var(--color-bg)]/85 backdrop-blur-sm px-8 pt-3 pb-3">
          <div className="flex items-center gap-3 mb-3">
            <div className="relative flex-1 max-w-md">
              <Search
                size={14}
                strokeWidth={2}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-fg-muted)] pointer-events-none"
              />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search components and snippets…"
                className="w-full h-9 pl-9 pr-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-sm focus:outline-none focus:border-[var(--color-accent)]/60"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Chip
              active={activeCategory === null}
              onClick={() => setActiveCategory(null)}
              label={`All ${allTiles.length}`}
              prominent
            />
            {LIBRARY_CATEGORIES.map((cat) => {
              const count = allTiles.filter((t) => t.category === cat.label).length;
              if (count === 0) return null;
              return (
                <Chip
                  key={cat.id}
                  active={activeCategory === cat.label}
                  onClick={() => setActiveCategory(cat.label)}
                  label={`${cat.label} ${count}`}
                />
              );
            })}
            {snippetCount > 0 ? (
              <>
                <div className="h-5 w-px bg-[var(--color-border)] mx-1" />
                <Chip
                  active={activeCategory === "Snippets"}
                  onClick={() => setActiveCategory("Snippets")}
                  label={`Snippets ${snippetCount}`}
                  accent
                />
              </>
            ) : null}
          </div>
        </div>

        <div className="px-8 pb-12 mt-5">
          {filtered.length === 0 ? (
            <div className="py-16 text-center text-sm text-[var(--color-fg-muted)]">
              No matches for "{query}".
            </div>
          ) : (
            <div className="flex items-start gap-4">
              {columns.map((col, i) => {
                // Column index is stable (always COLS columns, no reordering),
                // so the index is a fine key — but using a string label keeps
                // biome's noArrayIndexKey happy and makes the markup readable.
                const colKey = `col-${i}`;
                return (
                  <div key={colKey} className="flex-1 flex flex-col gap-4 min-w-0">
                    {col.map((t) => (
                      <TileButton
                        key={`${t.ref.kind}:${t.ref.id}`}
                        tile={t}
                        previewMode={previewMode}
                        themeVersion={themeVersion}
                        onClick={() => openLibrary(t.ref)}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  label,
  prominent,
  accent,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  prominent?: boolean;
  accent?: boolean;
}) {
  const base =
    "px-3 h-7 rounded-full text-xs flex items-center transition-colors whitespace-nowrap";
  let cls: string;
  if (active && prominent) {
    cls = "bg-[var(--color-fg)] text-[var(--color-bg)] font-medium";
  } else if (active && accent) {
    cls = "bg-[var(--color-accent)] text-[var(--color-accent-fg)] font-medium";
  } else if (active) {
    cls = "bg-[var(--color-fg)] text-[var(--color-bg)] font-medium";
  } else if (accent) {
    cls =
      "border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/5 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10";
  } else {
    cls =
      "border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]";
  }
  return (
    <button type="button" onClick={onClick} className={`${base} ${cls}`}>
      {label}
    </button>
  );
}

function TileButton({
  tile,
  previewMode,
  themeVersion,
  onClick,
}: {
  tile: Tile;
  previewMode: string;
  themeVersion: number;
  onClick: () => void;
}) {
  const isSnippet = tile.isSnippet;
  const url =
    tile.ref.kind === "snippet"
      ? `/api/render/snippet/${encodeURIComponent(tile.ref.id)}?w=480&h=${tile.previewHeight}&v=${themeVersion}${previewMode}`
      : `/api/render/component/${encodeURIComponent(tile.ref.id)}?w=480&h=${tile.previewHeight}&v=${themeVersion}${previewMode}`;

  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "group block w-full overflow-hidden rounded-lg border bg-[var(--color-surface)] text-left transition-colors " +
        (isSnippet
          ? "border-[var(--color-accent)]/30 ring-1 ring-[var(--color-accent)]/10 hover:border-[var(--color-accent)]/60"
          : "border-[var(--color-border)] hover:border-[var(--color-accent)]/40")
      }
    >
      <div
        className="relative w-full overflow-hidden bg-[var(--color-bg)]"
        style={{ height: tile.previewHeight }}
      >
        <iframe
          src={url}
          title={`${tile.label} preview`}
          loading="lazy"
          className="absolute inset-0 w-full h-full pointer-events-none border-0"
        />
      </div>
      <div className="px-3 py-2 border-t border-[var(--color-border)] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={
              "h-1.5 w-1.5 rounded-full shrink-0 " +
              (isSnippet ? "bg-[var(--color-accent)]" : "bg-[var(--color-fg-muted)]")
            }
          />
          <span className="text-xs font-medium truncate text-[var(--color-fg)]">{tile.label}</span>
        </div>
        <span
          className={
            "text-[10px] uppercase tracking-wider " +
            (isSnippet ? "text-[var(--color-accent)] opacity-80" : "text-[var(--color-fg-muted)]")
          }
        >
          {isSnippet ? "Snippet" : tile.category}
        </span>
      </div>
    </button>
  );
}
