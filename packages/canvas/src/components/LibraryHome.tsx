import { Search, SearchX } from "lucide-react";
import { useMemo, useState } from "react";
import type { SnippetMeta } from "../api.ts";
import { libraryCategories } from "../library-categories.ts";
import { type LibraryItemRef, useCanvas } from "../store.ts";
import { Badge } from "./ui/badge.tsx";
import { Card, CardFooter } from "./ui/card.tsx";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty.tsx";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./ui/input-group.tsx";
import { Separator } from "./ui/separator.tsx";
import { Skeleton } from "./ui/skeleton.tsx";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group.tsx";

/** A ToggleGroup value cannot be null, so "every shelf" needs a name. */
const ALL_SHELVES = "\u0000all";

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
  Toaster: 140,
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
  const loadingComponents = useCanvas((s) => s.components === null && s.componentsLoading);
  const openLibrary = useCanvas((s) => s.openLibrary);
  const themeVersion = useCanvas((s) => s.themeVersion);
  const designMode = useCanvas((s) => s.designMode);

  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const categories = useMemo(() => libraryCategories(components), [components]);

  const allTiles: Tile[] = useMemo(() => {
    const out: Tile[] = [];
    for (const cat of categories) {
      for (const id of cat.components) {
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
        previewHeight: 150,
      });
    }
    return out;
  }, [categories, snippets]);

  const componentCount = allTiles.filter((t) => !t.isSnippet).length;
  const snippetCount = allTiles.filter((t) => t.isSnippet).length;

  const q = query.trim().toLowerCase();
  const matches = (s: string) => !q || s.toLowerCase().includes(q);
  const filtered = allTiles.filter((t) => {
    if (activeCategory && t.category !== activeCategory) return false;
    if (!matches(t.label)) return false;
    return true;
  });

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
    <div className="flex-1 overflow-auto scroll-stable bg-background">
      <div className="mx-auto w-full max-w-6xl flex flex-col">
        <header className="px-8 pt-10 pb-5">
          <div className="flex items-baseline gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">Library</h1>
            <span className="text-sm text-muted-foreground">
              {loadingComponents ? "loading components" : `${componentCount} components`} ·{" "}
              {snippetCount} snippets
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
            Everything you can drop onto a board. Click a tile to see variants and props.
          </p>
        </header>

        <div className="sticky top-0 z-20 bg-background/85 backdrop-blur-sm px-8 pt-3 pb-3">
          <div className="flex items-center gap-3 mb-3">
            <InputGroup className="h-9 flex-1 max-w-md">
              <InputGroupAddon>
                <Search size={14} strokeWidth={2} />
              </InputGroupAddon>
              <InputGroupInput
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search components and snippets…"
              />
            </InputGroup>
          </div>
          <ToggleGroup
            type="single"
            // ALL_SHELVES stands in for "no filter": Radix drops the value when
            // the active item is pressed again, and a shelf list with nothing
            // selected has no meaning.
            value={activeCategory ?? ALL_SHELVES}
            onValueChange={(next) => {
              if (!next) return;
              setActiveCategory(next === ALL_SHELVES ? null : next);
            }}
            aria-label="Component shelf"
            className="flex-wrap items-center justify-start gap-2"
          >
            <Chip value={ALL_SHELVES} label={`All ${allTiles.length}`} />
            {categories.map((cat) => {
              const count = allTiles.filter((t) => t.category === cat.label).length;
              if (count === 0) return null;
              return <Chip key={cat.id} value={cat.label} label={`${cat.label} ${count}`} />;
            })}
            {snippetCount > 0 ? (
              <>
                <Separator orientation="vertical" className="mx-1 h-5" />
                <Chip value="Snippets" label={`Snippets ${snippetCount}`} accent />
              </>
            ) : null}
          </ToggleGroup>
        </div>

        <div className="px-8 pb-12 mt-5 flex flex-col gap-4">
          {filtered.length > 0 ? (
            <div className="flex items-start gap-4">
              {columns.map((col, i) => {
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
          ) : null}
          {loadingComponents ? (
            <PendingTiles />
          ) : filtered.length === 0 ? (
            <Empty className="py-16">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <SearchX />
                </EmptyMedia>
                <EmptyTitle>No matches for "{query}".</EmptyTitle>
                <EmptyDescription>
                  Try a shorter word, or clear the shelf filter above.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * The manifest arrives on a round trip of its own, after the snippets the
 * design summary already carried. Standing in for the component tiles keeps
 * the grid from reading as a library with nothing in it.
 */
function PendingTiles() {
  return (
    <div className="flex items-start gap-4" aria-hidden="true">
      {["left", "middle", "right"].map((col) => (
        <div key={col} className="flex-1 flex flex-col gap-4 min-w-0">
          <Skeleton className="h-[160px] w-full" />
          <Skeleton className="h-[110px] w-full" />
          <Skeleton className="h-[140px] w-full" />
        </div>
      ))}
    </div>
  );
}

/** Snippets are the folder's own work, so their chip keeps the accent hue. */
function Chip({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <ToggleGroupItem
      value={value}
      className={
        "h-7 rounded-full px-3 text-xs whitespace-nowrap " +
        (accent
          ? "border-primary/40 bg-primary/5 text-primary hover:bg-primary/10 hover:text-primary data-[state=on]:bg-primary data-[state=on]:font-medium data-[state=on]:text-primary-foreground"
          : "bg-card text-muted-foreground data-[state=on]:bg-foreground data-[state=on]:font-medium data-[state=on]:text-background")
      }
    >
      {label}
    </ToggleGroupItem>
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
    <Card
      className={
        "gap-0 py-0 transition-shadow " +
        (isSnippet ? "ring-primary/25 hover:ring-primary/60" : "hover:ring-primary/40")
      }
    >
      <button
        type="button"
        onClick={onClick}
        className="block w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <div
          className="relative w-full overflow-hidden bg-background"
          style={{ height: tile.previewHeight }}
        >
          <Skeleton className="absolute inset-0 rounded-none" />
          <iframe
            src={url}
            title={`${tile.label} preview`}
            loading="lazy"
            className="absolute inset-0 w-full h-full pointer-events-none border-0"
          />
        </div>
        <CardFooter className="flex items-center justify-between gap-2 border-t px-3 py-2">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={
                "h-1.5 w-1.5 rounded-full shrink-0 " +
                (isSnippet ? "bg-primary" : "bg-muted-foreground")
              }
            />
            <span className="text-xs font-medium truncate">{tile.label}</span>
          </div>
          <Badge
            variant={isSnippet ? "secondary" : "outline"}
            className={
              "px-1.5 py-0 text-[10px] uppercase tracking-wider " +
              (isSnippet ? "text-primary" : "text-muted-foreground")
            }
          >
            {isSnippet ? "Snippet" : tile.category}
          </Badge>
        </CardFooter>
      </button>
    </Card>
  );
}
