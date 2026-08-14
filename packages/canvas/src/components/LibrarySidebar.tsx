import { Component as ComponentIcon, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { SnippetMeta } from "../api.ts";
import { LIBRARY_CATEGORIES } from "../library-categories.ts";
import { useCanvas } from "../store.ts";

interface Props {
  snippets: SnippetMeta[];
}

/**
 * Categorized list of every shadcn / velloo component plus the user's
 * snippets. Snippets sit at the top — they're the user's own additions
 * and feel like the most-likely starting point. The categorized
 * components follow underneath, separated by larger gaps and a thin
 * divider per group so it's obvious where Actions ends and Forms begins.
 */
export function LibrarySidebar({ snippets }: Props) {
  const components = useCanvas((s) => s.components);
  const libraryItem = useCanvas((s) => s.libraryItem);
  const openLibrary = useCanvas((s) => s.openLibrary);
  const [query, setQuery] = useState("");

  const componentIds = useMemo(() => {
    if (!components) return new Set<string>();
    return new Set(components.map((c) => c.id));
  }, [components]);

  const q = query.trim().toLowerCase();
  const matches = (s: string) => !q || s.toLowerCase().includes(q);
  const filteredSnippets = snippets.filter((s) => matches(s.name) || matches(s.id));

  return (
    <>
      <section className="border-b border-[var(--color-border)] p-2">
        <div className="relative">
          <Search
            size={12}
            strokeWidth={2}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-fg-muted)] pointer-events-none"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search library…"
            className="w-full h-7 pl-7 pr-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)] text-sm focus:outline-none focus:border-[var(--color-accent)]/60"
          />
        </div>
      </section>

      <div className="flex-1 overflow-auto">
        <SectionHeader icon={<ComponentIcon size={11} strokeWidth={2} />} label="Snippets" accent />
        {snippets.length === 0 ? (
          <div className="px-4 py-3 text-xs text-[var(--color-fg-muted)] leading-relaxed">
            No snippets yet. Create one with{" "}
            <code className="px-1 py-0.5 rounded bg-[var(--color-bg)] text-[10px] font-mono">
              add_snippet
            </code>{" "}
            in the MCP, or save a subtree from a screen.
          </div>
        ) : filteredSnippets.length === 0 ? (
          <div className="px-4 py-3 text-xs text-[var(--color-fg-muted)]">
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
                      "w-full text-left px-2 py-1 rounded text-sm transition-colors flex items-center gap-2 " +
                      (active
                        ? "bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
                        : "hover:bg-[var(--color-bg)] text-[var(--color-fg)]")
                    }
                  >
                    <span
                      className={
                        "h-1 w-1 rounded-full shrink-0 " +
                        (active ? "bg-[var(--color-accent-fg)]" : "bg-[var(--color-accent)]")
                      }
                    />
                    <span className="truncate">{s.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="h-px bg-[var(--color-border)] mx-2 my-3" />

        {LIBRARY_CATEGORIES.map((cat) => {
          const items = cat.components.filter(
            (id) => componentIds.size === 0 || componentIds.has(id),
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
                          "w-full text-left px-2 py-1 rounded text-sm transition-colors " +
                          (active
                            ? "bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
                            : "hover:bg-[var(--color-bg)] text-[var(--color-fg)]")
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
        (accent ? "text-[var(--color-accent)]" : "text-[var(--color-fg-muted)]")
      }
    >
      {icon}
      <span className="flex-1">{label}</span>
      {count !== undefined ? (
        <span className="text-[10px] font-normal text-[var(--color-fg-muted)] tabular-nums">
          {count}
        </span>
      ) : null}
    </div>
  );
}
