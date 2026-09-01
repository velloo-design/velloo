import { Archive, ArchiveRestore, LayoutGrid, Lock } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { type FolderConfig, mutate } from "../../api.ts";
import { useCanvas } from "../../store.ts";
import { toastError } from "../../toast.ts";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select.tsx";
import { SectionLabel, SettingRow, SettingRows } from "./parts.tsx";

/** Sentinel for "inherit the folder's theme" — Select has no empty value. */
const FOLDER_DEFAULT = "__default__";

/**
 * Board scope — one board's own file. Which board is being edited is part of
 * the pane rather than fixed to the canvas selection, so the dialog can fix
 * the theme on a board you aren't looking at.
 */
export function BoardPane({ cfg }: { cfg: FolderConfig }) {
  const currentBoardId = useCanvas((s) => s.currentBoardId);
  const summary = useCanvas((s) => s.design);
  const boards = useCanvas((s) => s.boards);
  const loadBoard = useCanvas((s) => s.loadBoard);
  const setBoardArchived = useCanvas((s) => s.setBoardArchived);

  const all = [...(summary?.boards ?? []), ...(summary?.archivedBoards ?? [])];
  const [boardId, setBoardId] = useState(currentBoardId ?? all[0]?.id ?? "");
  const meta = all.find((b) => b.id === boardId) ?? null;
  const board = boards[boardId] ?? null;

  const nameId = useId();
  const themeId = useId();

  // The full board (theme, groups) is only cached once opened — pull it for
  // whichever board this pane is pointed at.
  useEffect(() => {
    if (boardId) void loadBoard(boardId).catch(() => {});
  }, [boardId, loadBoard]);

  if (!meta) {
    return <p className="text-[13px] text-muted-foreground">This folder has no boards yet.</p>;
  }

  const archived = meta.archivedAt != null;
  const screenCount = new Set((board?.frames ?? []).map((f) => f.screen)).size;

  const rename = async (name: string) => {
    if (name === meta.name) return;
    try {
      await mutate.updateBoard({ boardId, patch: { name } });
    } catch (err) {
      toastError(err, "Could not rename the board");
    }
  };

  const setTheme = async (value: string) => {
    try {
      await mutate.updateBoard({
        boardId,
        patch: { theme: value === FOLDER_DEFAULT ? null : value },
      });
      await loadBoard(boardId);
    } catch (err) {
      toastError(err, "Could not change the board theme");
    }
  };

  return (
    <>
      <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
        <LayoutGrid className="size-4 shrink-0 text-muted-foreground" />
        <span className="text-[12px] text-muted-foreground">Editing</span>
        <Select value={boardId} onValueChange={setBoardId}>
          <SelectTrigger className="ml-auto w-[300px] bg-background text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(summary?.boards ?? []).map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
            {(summary?.archivedBoards ?? []).map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name} (archived)
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <SectionLabel className="mt-5">Identity</SectionLabel>
      <SettingRows>
        <SettingRow
          label="Name"
          description="Shown in the sidebar, search, and published links."
          htmlFor={nameId}
        >
          <NameField id={nameId} value={meta.name} onCommit={rename} />
        </SettingRow>
        <SettingRow
          label="Board id"
          description="The filename on disk. Fixed once created — frames and links point at it."
        >
          <div className="flex w-[300px] items-center gap-2 rounded-md bg-muted px-2.5 py-1.5">
            <span className="truncate font-mono text-[12px] text-muted-foreground">
              boards/{boardId}.json
            </span>
            <Lock className="ml-auto size-3 shrink-0 text-muted-foreground" />
          </div>
        </SettingRow>
      </SettingRows>

      <SectionLabel className="mt-5">Theme</SectionLabel>
      <SettingRows>
        <SettingRow
          label="Render this board with"
          description="Every frame here re-renders on change. Screens are untouched."
          htmlFor={themeId}
        >
          <Select value={board?.theme ?? FOLDER_DEFAULT} onValueChange={setTheme}>
            <SelectTrigger id={themeId} className="w-[300px] text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={FOLDER_DEFAULT}>Folder default</SelectItem>
              {cfg.themes
                .filter((t) => t !== "default")
                .map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </SettingRow>
      </SettingRows>

      <SectionLabel className="mt-5">Contents</SectionLabel>
      <div className="mt-2 grid grid-cols-3 gap-3">
        <Stat n={board?.frames.length ?? meta.frameCount} label="frames" />
        <Stat n={screenCount} label={screenCount === 1 ? "screen" : "screens"} />
        <Stat
          n={board?.groups.length ?? 0}
          label={board?.groups.length === 1 ? "group" : "groups"}
        />
      </div>

      <div className="mt-4 flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3">
        {archived ? (
          <ArchiveRestore className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        ) : (
          <Archive className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-foreground">
            {archived ? "This board is archived" : "Archive this board"}
          </div>
          <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
            {archived
              ? "It stays out of the sidebar and out of publishes until you restore it."
              : "Files it out of the sidebar and out of publishes. Nothing is deleted — the file stays and you can restore it any time."}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto h-8 shrink-0 text-[12.5px]"
          onClick={() => {
            void setBoardArchived(boardId, !archived).catch((err) =>
              toastError(err, archived ? "Could not restore the board" : "Could not archive it"),
            );
          }}
        >
          {archived ? "Restore" : "Archive"}
        </Button>
      </div>
    </>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="rounded-lg bg-muted/50 px-3 py-2">
      <div className="text-[18px] font-semibold leading-tight text-foreground">{n}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

/** Commits on blur or Enter; Escape restores the stored name. */
function NameField({
  id,
  value,
  onCommit,
}: {
  id: string;
  value: string;
  onCommit: (name: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  // Adopt the stored name on a board switch or an external rename.
  useEffect(() => setDraft(value), [value]);
  return (
    <Input
      id={id}
      value={draft}
      className="h-8 w-[300px] text-[13px]"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const next = draft.trim();
        if (next === "") setDraft(value);
        else onCommit(next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setDraft(value);
      }}
    />
  );
}
