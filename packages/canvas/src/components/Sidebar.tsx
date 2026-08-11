import type { PageMeta } from "../api.ts";
import { useCanvas } from "../store.ts";

interface Props {
  pages: PageMeta[];
  currentPageId: string | null;
  snapshotVersion: string;
  themeName: string;
}

export function Sidebar({ pages, currentPageId, snapshotVersion, themeName }: Props) {
  const selectPage = useCanvas((s) => s.selectPage);
  return (
    <aside className="flex h-full w-72 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]">
      <header className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
        <span className="font-semibold tracking-tight">Velloo</span>
        <span className="text-xs text-[var(--color-fg-muted)]">{themeName}</span>
      </header>
      <nav className="flex-1 overflow-y-auto p-2">
        <div className="px-2 py-1 text-xs uppercase tracking-wider text-[var(--color-fg-muted)]">
          Pages
        </div>
        {pages.length === 0 ? (
          <div className="px-2 py-2 text-sm text-[var(--color-fg-muted)]">
            No pages yet. Create one in <code>pages/</code>.
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5 mt-1">
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
      </nav>
      <footer className="px-4 py-2 text-xs text-[var(--color-fg-muted)] border-t border-[var(--color-border)]">
        shadcn snapshot {snapshotVersion}
      </footer>
    </aside>
  );
}
