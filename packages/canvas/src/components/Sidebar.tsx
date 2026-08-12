import type { Page } from "@velloo/schema";
import { MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { mutate, type PageMeta } from "../api.ts";
import { useCanvas } from "../store.ts";
import { Tree } from "./Tree.tsx";

interface Props {
  pages: PageMeta[];
  currentPageId: string | null;
  currentPage: Page | null;
  snapshotVersion: string;
}

export function Sidebar({ pages, currentPageId, currentPage, snapshotVersion }: Props) {
  const selectPage = useCanvas((s) => s.selectPage);
  const selection = useCanvas((s) => s.selection);
  const cursorMode = useCanvas((s) => s.cursorMode);

  // Which variant's tree is shown. Follows the user's selection; falls back to
  // the first variant when there's no selection yet.
  const [activeVariantId, setActiveVariantId] = useState<string | null>(null);
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null);

  useEffect(() => {
    if (!currentPage) {
      setActiveVariantId(null);
      return;
    }
    if (selection?.variantId) {
      setActiveVariantId(selection.variantId);
      return;
    }
    setActiveVariantId((prev) =>
      prev && currentPage.variants.some((v) => v.id === prev)
        ? prev
        : (currentPage.variants[0]?.id ?? null),
    );
  }, [currentPage, selection]);

  const activeVariant = currentPage?.variants.find((v) => v.id === activeVariantId) ?? null;

  const onCreatePage = async () => {
    const name = window.prompt("Page name", "New page");
    if (!name) return;
    try {
      const result = await mutate.addPage({ name });
      void selectPage(result.pageId);
    } catch {
      /* surface elsewhere if/when we add a toast layer */
    }
  };

  const onDeletePage = (pageId: string, pageName: string) => {
    setMenuOpenFor(null);
    if (!window.confirm(`Delete page "${pageName}"? You can undo with ⌘Z.`)) return;
    void mutate.removePage({ pageId }).catch(() => undefined);
  };

  return (
    <aside className="flex h-full w-80 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]">
      <section className="border-b border-[var(--color-border)] py-2">
        <div className="px-4 py-2 flex items-center justify-between gap-2 text-xs uppercase tracking-wider text-[var(--color-fg-muted)]">
          <span>Pages</span>
          <button
            type="button"
            onClick={onCreatePage}
            title="New page"
            className="h-5 w-5 grid place-items-center rounded hover:bg-[var(--color-bg)] hover:text-[var(--color-fg)]"
          >
            <Plus size={13} strokeWidth={2} />
          </button>
        </div>
        {pages.length === 0 ? (
          <div className="px-4 py-2 text-sm text-[var(--color-fg-muted)]">
            No pages yet. Use <Plus size={11} className="inline -mt-0.5" /> above to create one.
          </div>
        ) : (
          <ul className="flex flex-col px-2 gap-0.5 mt-1">
            {pages.map((p) => {
              const active = p.id === currentPageId;
              const menuOpen = menuOpenFor === p.id;
              return (
                <li key={p.id} className="relative group/page">
                  <button
                    type="button"
                    onClick={() => {
                      void selectPage(p.id);
                    }}
                    className={
                      "w-full text-left px-2 py-1.5 pr-8 rounded text-sm transition-colors " +
                      (active
                        ? "bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
                        : "hover:bg-[var(--color-bg)] text-[var(--color-fg)]")
                    }
                  >
                    <div className="font-medium truncate">{p.name}</div>
                    <div
                      className={
                        "text-xs " +
                        (active
                          ? "text-[var(--color-accent-fg)] opacity-80"
                          : "text-[var(--color-fg-muted)]")
                      }
                    >
                      {p.variants.length} variant{p.variants.length === 1 ? "" : "s"}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenFor(menuOpen ? null : p.id);
                    }}
                    title="Page menu"
                    className={
                      "absolute right-2 top-2 h-5 w-5 grid place-items-center rounded text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface)] " +
                      (menuOpen ? "opacity-100" : "opacity-0 group-hover/page:opacity-100")
                    }
                  >
                    <MoreHorizontal size={13} strokeWidth={2} />
                  </button>
                  {menuOpen ? (
                    <>
                      <button
                        type="button"
                        aria-label="Close menu"
                        onClick={() => setMenuOpenFor(null)}
                        className="fixed inset-0 z-40 cursor-default"
                      />
                      <div className="absolute right-2 top-9 z-50 w-36 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] shadow-md py-1 text-sm">
                        <button
                          type="button"
                          disabled={pages.length <= 1}
                          onClick={() => onDeletePage(p.id, p.name)}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[var(--color-destructive,red)] hover:bg-[var(--color-bg)] disabled:opacity-40 disabled:pointer-events-none"
                        >
                          <Trash2 size={13} strokeWidth={2} />
                          Delete page
                        </button>
                      </div>
                    </>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex-1 flex flex-col min-h-0">
        <div className="px-4 py-2 flex items-center justify-between gap-2 text-xs uppercase tracking-wider text-[var(--color-fg-muted)] border-b border-[var(--color-border)]">
          <span>Tree</span>
          {currentPage && currentPage.variants.length > 1 ? (
            <select
              value={activeVariantId ?? ""}
              onChange={(e) => setActiveVariantId(e.target.value || null)}
              className="text-[10px] uppercase tracking-wider rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-0.5"
            >
              {currentPage.variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          ) : null}
        </div>
        <div
          className={
            "flex-1 overflow-auto py-1 " +
            (cursorMode === "hand" ? "opacity-40 pointer-events-none select-none" : "")
          }
          aria-disabled={cursorMode === "hand"}
        >
          {activeVariant ? (
            <Tree variant={activeVariant} />
          ) : (
            <div className="px-4 py-2 text-xs text-[var(--color-fg-muted)]">
              Pick a page to see its tree.
            </div>
          )}
        </div>
      </section>

      <footer className="px-4 py-2 text-xs text-[var(--color-fg-muted)] border-t border-[var(--color-border)]">
        shadcn snapshot {snapshotVersion}
      </footer>
    </aside>
  );
}
