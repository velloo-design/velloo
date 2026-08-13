import { MoreHorizontal, Plus, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { mutate, type ScreenMeta, type SnippetMeta } from "../api.ts";
import { useCanvas } from "../store.ts";
import { toastError } from "../toast.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { Tree } from "./Tree.tsx";

interface Props {
  screens: ScreenMeta[];
  snippets: SnippetMeta[];
  currentScreenId: string | null;
  snapshotVersion: string;
}

export function Sidebar({ screens, snippets, currentScreenId, snapshotVersion }: Props) {
  const selectScreen = useCanvas((s) => s.selectScreen);
  const selection = useCanvas((s) => s.selection);
  const cursorMode = useCanvas((s) => s.cursorMode);
  const currentScreen = useCanvas((s) =>
    currentScreenId ? (s.screens[currentScreenId] ?? null) : null,
  );

  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);

  const onCreateScreen = async () => {
    const name = window.prompt("Screen name", "New screen");
    if (!name) return;
    try {
      const result = await mutate.addScreen({ name });
      void selectScreen(result.screenId);
    } catch (err) {
      toastError(err, "Could not create screen");
    }
  };

  const onDeleteScreen = (screenId: string, screenName: string) => {
    setMenuOpenFor(null);
    setPendingDelete({ id: screenId, name: screenName });
  };

  const confirmDeleteScreen = () => {
    if (!pendingDelete) return;
    const { id } = pendingDelete;
    setPendingDelete(null);
    void mutate
      .removeScreen({ screenId: id })
      .catch((e) => toastError(e, "Could not delete screen"));
  };

  return (
    <aside className="flex h-full w-80 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]">
      <section className="border-b border-[var(--color-border)] py-2">
        <div className="px-4 py-2 flex items-center justify-between gap-2 text-xs uppercase tracking-wider text-[var(--color-fg-muted)]">
          <span>Screens</span>
          <button
            type="button"
            onClick={onCreateScreen}
            title="New screen"
            className="h-5 w-5 grid place-items-center rounded hover:bg-[var(--color-bg)] hover:text-[var(--color-fg)]"
          >
            <Plus size={13} strokeWidth={2} />
          </button>
        </div>
        {screens.length === 0 ? (
          <div className="px-4 py-2 text-sm text-[var(--color-fg-muted)]">
            No screens yet. Use <Plus size={11} className="inline -mt-0.5" /> above to create one.
          </div>
        ) : (
          <ul className="flex flex-col px-2 gap-0.5 mt-1">
            {screens.map((s) => {
              const active = s.id === currentScreenId;
              const menuOpen = menuOpenFor === s.id;
              return (
                <li key={s.id} className="relative group/screen">
                  <button
                    type="button"
                    onClick={() => {
                      void selectScreen(s.id);
                    }}
                    className={
                      "w-full text-left px-2 py-1.5 pr-8 rounded text-sm transition-colors " +
                      (active
                        ? "bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
                        : "hover:bg-[var(--color-bg)] text-[var(--color-fg)]")
                    }
                  >
                    <div className="font-medium truncate">{s.name}</div>
                  </button>
                  <button
                    type="button"
                    onClick={(e: React.MouseEvent) => {
                      e.stopPropagation();
                      setMenuOpenFor(menuOpen ? null : s.id);
                    }}
                    title="Screen menu"
                    className={
                      "absolute right-2 top-2 h-5 w-5 grid place-items-center rounded text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface)] " +
                      (menuOpen ? "opacity-100" : "opacity-0 group-hover/screen:opacity-100")
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
                          disabled={screens.length <= 1}
                          onClick={() => onDeleteScreen(s.id, s.name)}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[var(--color-destructive,red)] hover:bg-[var(--color-bg)] disabled:opacity-40 disabled:pointer-events-none"
                        >
                          <Trash2 size={13} strokeWidth={2} />
                          Delete screen
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
        </div>
        <div
          className={
            "flex-1 overflow-auto py-1 " +
            (cursorMode === "hand" ? "opacity-40 pointer-events-none select-none" : "")
          }
          aria-disabled={cursorMode === "hand"}
        >
          {currentScreen ? (
            <Tree screen={currentScreen} />
          ) : (
            <div className="px-4 py-2 text-xs text-[var(--color-fg-muted)]">
              Pick a screen to see its tree.
            </div>
          )}
        </div>
      </section>

      {snippets.length > 0 ? (
        <section className="border-t border-[var(--color-border)] py-2">
          <div className="px-4 py-2 flex items-center gap-2 text-xs uppercase tracking-wider text-[var(--color-fg-muted)]">
            <Sparkles size={11} strokeWidth={2} />
            <span>Snippets</span>
          </div>
          <ul className="flex flex-col px-2 gap-0.5">
            {snippets.map((s) => {
              const instantiate = async () => {
                if (!currentScreenId) return;
                try {
                  await mutate.instantiateSnippet({
                    screenId: currentScreenId,
                    parentPath: selection?.path
                      ? selection.path.split(".").filter(Boolean).map(Number)
                      : [],
                    snippetId: s.id,
                  });
                } catch (err) {
                  toastError(err, "Could not instantiate snippet");
                }
              };
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={instantiate}
                    disabled={!currentScreenId}
                    className="w-full text-left px-2 py-1.5 rounded text-sm hover:bg-[var(--color-bg)] text-[var(--color-fg)] disabled:opacity-40 disabled:pointer-events-none"
                    title={`Click to instantiate. ${s.params.length} param${s.params.length === 1 ? "" : "s"}.`}
                  >
                    <div className="font-medium truncate">{s.name}</div>
                    <div className="text-xs text-[var(--color-fg-muted)]">
                      {s.params.length === 0 ? "no params" : s.params.map((p) => p.name).join(", ")}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <footer className="px-4 py-2 text-xs text-[var(--color-fg-muted)] border-t border-[var(--color-border)]">
        shadcn snapshot {snapshotVersion}
      </footer>
      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete screen"
        body={
          pendingDelete
            ? `Delete screen "${pendingDelete.name}"? You can put it back with ⌘Z.`
            : ""
        }
        confirmLabel="Delete"
        destructive
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDeleteScreen}
      />
    </aside>
  );
}
