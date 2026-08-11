import type { Page } from "@velloo/schema";
import { useEffect, useState } from "react";
import type { PageMeta } from "../api.ts";
import { useCanvas } from "../store.ts";
import { Tree } from "./Tree.tsx";

interface Props {
  pages: PageMeta[];
  currentPageId: string | null;
  currentPage: Page | null;
  snapshotVersion: string;
  themeName: string;
}

export function Sidebar({ pages, currentPageId, currentPage, snapshotVersion, themeName }: Props) {
  const selectPage = useCanvas((s) => s.selectPage);
  const selection = useCanvas((s) => s.selection);
  const cursorMode = useCanvas((s) => s.cursorMode);

  // Which variant's tree is shown. Follows the user's selection; falls back to
  // the first variant when there's no selection yet.
  const [activeVariantId, setActiveVariantId] = useState<string | null>(null);

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

  return (
    <aside className="flex h-full w-80 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]">
      <header className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
        <span className="font-semibold tracking-tight">Velloo</span>
        <span className="text-xs text-[var(--color-fg-muted)]">{themeName}</span>
      </header>

      <section className="border-b border-[var(--color-border)] py-2">
        <div className="px-4 py-1 text-xs uppercase tracking-wider text-[var(--color-fg-muted)]">
          Pages
        </div>
        {pages.length === 0 ? (
          <div className="px-4 py-2 text-sm text-[var(--color-fg-muted)]">
            No pages yet. Create one in <code>pages/</code>.
          </div>
        ) : (
          <ul className="flex flex-col px-2 gap-0.5 mt-1">
            {pages.map((p) => {
              const active = p.id === currentPageId;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => {
                      void selectPage(p.id);
                    }}
                    className={
                      "w-full text-left px-2 py-1.5 rounded text-sm transition-colors " +
                      (active
                        ? "bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
                        : "hover:bg-[var(--color-bg)] text-[var(--color-fg)]")
                    }
                  >
                    <div className="font-medium">{p.name}</div>
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
