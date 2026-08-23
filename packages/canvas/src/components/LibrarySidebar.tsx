import { Component as ComponentIcon, Package, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { SnippetMeta } from "../api.ts";
import { LIBRARY_CATEGORIES } from "../library-categories.ts";
import { useCanvas } from "../store.ts";
import { Input } from "./ui/input.tsx";

interface Props {
  snippets: SnippetMeta[];
}

export function LibrarySidebar({ snippets }: Props) {
  const components = useCanvas((s) => s.components);
  const libraryItem = useCanvas((s) => s.libraryItem);
  const openLibrary = useCanvas((s) => s.openLibrary);
  const [query, setQuery] = useState("");

  const { libraryComponentIds, extensions } = useMemo(() => {
    if (!components) {
      return {
        libraryComponentIds: new Set<string>(),
        extensions: [] as { id: string; label: string }[],
      };
    }
    // /api/components returns library entries + extensions,
    // each tagged with `kind`. Older builds omit `kind`; treat those as library.
    const ids = new Set<string>();
    const exts: { id: string; label: string }[] = [];
    for (const c of components as Array<(typeof components)[number] & { kind?: string }>) {
      if (c.kind === "extension") {
        exts.push({ id: c.id, label: c.id });
      } else {
        ids.add(c.id);
      }
    }
    exts.sort((a, b) => a.id.localeCompare(b.id));
    return { libraryComponentIds: ids, extensions: exts };
  }, [components]);

  const q = query.trim().toLowerCase();
  const matches = (s: string) => !q || s.toLowerCase().includes(q);
  const filteredSnippets = snippets.filter((s) => matches(s.name) || matches(s.id));
  const filteredExtensions = extensions.filter((e) => matches(e.id));

  return (
    <>
      <section className="border-b p-2">
        <div className="relative">
          <Search
            size={12}
            strokeWidth={2}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <Input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search library…"
            className="h-7 pl-7"
          />
        </div>
      </section>

      <div className="flex-1 overflow-auto">
        <SectionHeader icon={<ComponentIcon size={11} strokeWidth={2} />} label="Snippets" accent />
        {snippets.length === 0 ? (
          <div className="px-4 py-3 text-xs text-muted-foreground leading-relaxed">
            No snippets yet. Create one with{" "}
            <code className="px-1 py-0.5 rounded bg-muted text-[10px] font-mono">add_snippet</code>{" "}
            in the MCP, or save a subtree from a screen.
          </div>
        ) : filteredSnippets.length === 0 ? (
          <div className="px-4 py-3 text-xs text-muted-foreground">
            No snippet matches "{query}".
          </div>
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
            <div className="h-px bg-border mx-2 my-3" />
            <SectionHeader
              icon={<Package size={11} strokeWidth={2} />}
              label="Extensions"
              count={filteredExtensions.length}
              accent
            />
            {filteredExtensions.length === 0 ? (
              <div className="px-4 py-3 text-xs text-muted-foreground">
                No extension matches "{query}".
              </div>
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

        <div className="h-px bg-border mx-2 my-3" />

        {LIBRARY_CATEGORIES.map((cat) => {
          const items = cat.components.filter(
            (id) => libraryComponentIds.size === 0 || libraryComponentIds.has(id),
          );
          const filtered = items.filter(matches);
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
        <span className="text-[10px] font-normal text-muted-foreground tabular-nums">{count}</span>
      ) : null}
    </div>
  );
}
