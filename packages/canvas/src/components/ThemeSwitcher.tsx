import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { mutate } from "../api.ts";
import { useCanvas } from "../store.ts";
import { toastError } from "../toast.ts";
import { NewThemeDialog } from "./NewThemeDialog.tsx";
import { MiniSelect } from "./style-editor/controls.tsx";
import { themeLabel } from "./theme-label.ts";

/**
 * Which theme this board renders with, and how to point it at another.
 *
 * Every design has a Default theme and may have others, each one a board can
 * pick. Switching writes the board's pin rather than swapping what the panel
 * reads, which keeps the one invariant that matters here: the theme being
 * edited is always the theme on screen. A picker that only changed the
 * panel's subject would put the rail and the frames back out of step — the
 * exact failure where dragging a rhythm control silently edited a file
 * nothing rendered.
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

  return (
    <div className="mb-3 flex flex-col gap-1.5 rounded-md border bg-muted/40 p-2">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Theme</span>
        <MiniSelect
          value={themeName}
          onChange={(name) => void pin(name)}
          options={options.map((name) => [name, themeLabel(name)])}
          className="ml-auto min-w-[8rem]"
          label="Theme this board uses"
        />
        <button
          type="button"
          onClick={() => setNaming(true)}
          disabled={!boardId}
          title="New theme"
          aria-label="New theme"
          className="size-7 shrink-0 grid place-items-center rounded-md border border-input bg-background text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          <Plus size={13} />
        </button>
      </div>
      <span className="text-[10px] leading-snug text-muted-foreground">
        {boardId
          ? themeName === "default"
            ? "The theme every board uses unless it picks another. Edits here reach all of those."
            : `This board uses ${themeName}. Edits here leave boards on other themes alone.`
          : "No board selected."}
      </span>
      {naming ? (
        <NewThemeDialog from={themeName} existing={options} onClose={() => setNaming(false)} />
      ) : null}
    </div>
  );
}
