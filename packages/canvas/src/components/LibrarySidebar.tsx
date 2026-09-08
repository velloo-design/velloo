import type { ComponentDescriptor } from "@velloo/provider";
import { Component as ComponentIcon, Package, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { SnippetMeta } from "../api.ts";
import { libraryCategories } from "../library-categories.ts";
import { useCanvas } from "../store.ts";
import { Badge } from "./ui/badge.tsx";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty.tsx";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./ui/input-group.tsx";
import { Kbd } from "./ui/kbd.tsx";
import { Separator } from "./ui/separator.tsx";

interface Props {
  snippets: SnippetMeta[];
}

export function LibrarySidebar({ snippets }: Props) {
  const components = useCanvas((s) => s.components);
  const libraryItem = useCanvas((s) => s.libraryItem);
  const openLibrary = useCanvas((s) => s.openLibrary);
  const [query, setQuery] = useState("");

  const { categories, extensions } = useMemo(() => {
    if (!components) {
      return { categories: [], extensions: [] as { id: string; label: string }[] };
    }
    // /api/components returns library entries + extensions,
    // each tagged with `kind`. Older builds omit `kind`; treat those as library.
    const library: ComponentDescriptor[] = [];
    const exts: { id: string; label: string }[] = [];
    for (const c of components as Array<(typeof components)[number] & { kind?: string }>) {
      if (c.kind === "extension") {
        exts.push({ id: c.id, label: c.id });
      } else {
        library.push(c);
      }
    }
    exts.sort((a, b) => a.id.localeCompare(b.id));
    return { categories: libraryCategories(library), extensions: exts };
  }, [components]);

  const q = query.trim().toLowerCase();
  const matches = (s: string) => !q || s.toLowerCase().includes(q);
  const filteredSnippets = snippets.filter((s) => matches(s.name) || matches(s.id));
  const filteredExtensions = extensions.filter((e) => matches(e.id));

  return (
    <>
      <section className="border-b p-2">
        <InputGroup className="h-7">
          <InputGroupAddon>
            <Search size={12} strokeWidth={2} />
          </InputGroupAddon>
          <InputGroupInput
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search library…"
          />
        </InputGroup>
      </section>

      <div className="flex-1 overflow-auto scroll-stable">
        <SectionHeader icon={<ComponentIcon size={11} strokeWidth={2} />} label="Snippets" accent />
        {snippets.length === 0 ? (
          <Empty className="gap-2 p-4">
            <EmptyHeader className="gap-1">
              <EmptyMedia variant="icon" className="size-8">
                <ComponentIcon />
              </EmptyMedia>
              <EmptyTitle className="text-xs">No snippets yet.</EmptyTitle>
              <EmptyDescription className="text-xs">
                Create one with <Kbd>add_snippet</Kbd> in the MCP, or save a subtree from a screen.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : filteredSnippets.length === 0 ? (
          <NoMatch query={query} noun="snippet" />
        ) : (
          <ul className="flex flex-col px-2 gap-0.5 pb-1">
            {filteredSnippets.map((s) => {
              const active = libraryItem?.kind === "snippet" && libraryItem.id === s.id;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => openLibrary({ kind: "snippet", id: s.id })}
                    className={
                      "w-full text-left px-2 py-1 rounded-md text-sm transition-colors flex items-center gap-2 " +
                      (active ? "bg-primary text-primary-foreground" : "hover:bg-muted")
                    }
                  >
                    <span
                      className={
                        "h-1 w-1 rounded-full shrink-0 " +
                        (active ? "bg-primary-foreground" : "bg-primary")
                      }
                    />
                    <span className="truncate">{s.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {extensions.length > 0 ? (
          <>
            <Separator className="mx-2 my-3" />
            <SectionHeader
              icon={<Package size={11} strokeWidth={2} />}
              label="Extensions"
              count={filteredExtensions.length}
              accent
            />
            {filteredExtensions.length === 0 ? (
              <NoMatch query={query} noun="extension" />
            ) : (
              <ul className="flex flex-col px-2 gap-0.5 pb-1">
                {filteredExtensions.map((e) => {
                  const active = libraryItem?.kind === "component" && libraryItem.id === e.id;
                  return (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => openLibrary({ kind: "component", id: e.id })}
                        className={`w-full text-left px-2 py-1 rounded-md text-sm transition-colors flex items-center gap-2 ${
                          active ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                        }`}
                        title={`Custom component registered via add_extension`}
                      >
                        <span
                          className={`h-1 w-1 rounded-full shrink-0 ${
                            active ? "bg-primary-foreground" : "bg-primary/60"
                          }`}
                        />
                        <span className="truncate">{e.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        ) : null}

        <Separator className="mx-2 my-3" />

        {categories.map((cat) => {
          const filtered = cat.components.filter(matches);
          if (filtered.length === 0) return null;
          return (
            <section key={cat.id} className="pb-2">
              <SectionHeader label={cat.label} count={filtered.length} />
              <ul className="flex flex-col px-2 gap-0.5">
                {filtered.map((id) => {
                  const active = libraryItem?.kind === "component" && libraryItem.id === id;
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={() => openLibrary({ kind: "component", id })}
                        className={
                          "w-full text-left px-2 py-1 rounded-md text-sm transition-colors " +
                          (active ? "bg-primary text-primary-foreground" : "hover:bg-muted")
                        }
                      >
                        {id}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}

function SectionHeader({
  label,
  count,
  icon,
  accent,
}: {
  label: string;
  count?: number;
  icon?: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div
      className={
        "px-4 pt-3 pb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold " +
        (accent ? "text-primary" : "text-muted-foreground")
      }
    >
      {icon}
      <span className="flex-1">{label}</span>
      {count !== undefined ? (
        <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-normal tabular-nums">
          {count}
        </Badge>
      ) : null}
    </div>
  );
}

/** The panel is narrow, so a filtered-to-nothing shelf stays a single line. */
function NoMatch({ query, noun }: { query: string; noun: string }) {
  return (
    <Empty className="p-3">
      <EmptyDescription className="text-xs">
        No {noun} matches "{query}".
      </EmptyDescription>
    </Empty>
  );
}
