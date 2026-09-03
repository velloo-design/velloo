import { Check, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { mutate, theme as themeApi } from "../api.ts";
import { useCanvas } from "../store.ts";
import { toastError } from "../toast.ts";
import { MiniSelect } from "./style-editor/controls.tsx";
import { Input } from "./ui/input.tsx";

const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

/**
 * Which theme this board renders with, and how to point it at another.
 *
 * Switching writes the board's pin rather than swapping what the panel reads,
 * which keeps the one invariant that matters here: the theme being edited is
 * always the theme on screen. A picker that only changed the panel's subject
 * would put the rail and the frames back out of step — the exact failure where
 * dragging a rhythm control silently edited a file nothing rendered.
 *
 * So this is a design edit, not a view toggle: it lands in the board file and
 * undoes with ⌘Z like any other.
 */
export function ThemeSwitcher() {
  const boardId = useCanvas((s) => s.currentBoardId);
  const themeName = useCanvas((s) => s.themeName);
  const folderConfig = useCanvas((s) => s.folderConfig);
  const loadFolderConfig = useCanvas((s) => s.loadFolderConfig);
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState("");

  // The theme list lives on the folder config, which only the settings dialog
  // used to need — so the panel has to ask for it itself.
  useEffect(() => {
    void loadFolderConfig();
  }, [loadFolderConfig]);

  const known = folderConfig?.themes ?? ["default"];
  // A theme added by an agent since the last config fetch would otherwise make
  // the select show a blank value for the theme it is actually editing.
  const options = known.includes(themeName) ? known : [...known, themeName];

  const pin = async (name: string) => {
    if (!boardId || name === themeName) return;
    try {
      await mutate.updateBoard({ boardId, patch: { theme: name === "default" ? null : name } });
    } catch (err) {
      toastError(err, "Could not switch the theme");
    }
  };

  const trimmed = draft.trim();
  const valid = NAME_PATTERN.test(trimmed) && trimmed !== "default" && !known.includes(trimmed);

  const create = async () => {
    if (!valid) return;
    setNaming(false);
    try {
      // Clone the theme on screen, not the folder default: the point is to try
      // a variant of what this board already looks like.
      await themeApi.addTheme(trimmed, themeName);
      await loadFolderConfig();
      await pin(trimmed);
    } catch (err) {
      toastError(err, "Could not create the theme");
    }
  };

  return (
    <div className="mb-3 flex flex-col gap-1.5 rounded-md border bg-muted/40 p-2">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Editing</span>
        <MiniSelect
          value={themeName}
          onChange={(name) => void pin(name)}
          options={options.map((name) => [name])}
          className="ml-auto min-w-[8rem] font-mono"
          label="Theme being edited"
        />
        <button
          type="button"
          onClick={() => {
            setDraft("");
            setNaming((v) => !v);
          }}
          title="New theme from this one"
          aria-label="New theme from this one"
          className="size-7 shrink-0 grid place-items-center rounded-md border border-input bg-background text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <Plus size={13} />
        </button>
      </div>

      {naming ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <Input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void create();
                if (e.key === "Escape") setNaming(false);
              }}
              placeholder="new-theme-name"
              spellCheck={false}
              aria-label="New theme name"
              className="h-7 flex-1 font-mono text-xs"
            />
            <button
              type="button"
              onClick={() => void create()}
              disabled={!valid}
              aria-label="Create theme"
              className="size-7 shrink-0 grid place-items-center rounded-md border border-input bg-background text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <Check size={13} />
            </button>
            <button
              type="button"
              onClick={() => setNaming(false)}
              aria-label="Cancel"
              className="size-7 shrink-0 grid place-items-center rounded-md text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <X size={13} />
            </button>
          </div>
          <span className="text-[10px] leading-snug text-muted-foreground/80">
            {trimmed.length > 0 && !valid
              ? known.includes(trimmed) || trimmed === "default"
                ? `"${trimmed}" already exists`
                : "Lowercase letters, digits and dashes — it becomes the file name"
              : `Copies ${themeName} to theme/${trimmed || "name"}.json and pins this board to it`}
          </span>
        </div>
      ) : (
        <span className="text-[10px] leading-snug text-muted-foreground">
          {boardId
            ? themeName === "default"
              ? "The folder default — edits here reach every board that hasn't pinned its own."
              : "Pinned by this board, so edits here leave every other board alone."
            : "No board selected."}
        </span>
      )}
    </div>
  );
}
