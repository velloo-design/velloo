import { DEFAULT_TYPESET_NAME, isTypesetName } from "@velloo/schema/typeset";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog.tsx";
import { Input } from "../ui/input.tsx";

interface Props {
  names: string[];
  selected: string;
  onSelect: (name: string) => void;
  onAdd: (name: string) => void;
  onRename: (from: string, to: string) => void;
  onRemove: (name: string) => void;
}

/**
 * The preset row: pick a typeset, add one, rename or delete the one you're on.
 *
 * The generated selector sits under the row because a preset is only useful
 * once you know what to put on a region — showing `.typeset-docs` is the
 * cheapest documentation the feature can carry.
 */
export function TypesetSwitcher({ names, selected, onSelect, onAdd, onRename, onRemove }: Props) {
  const [editing, setEditing] = useState<"add" | "rename" | null>(null);
  const [draft, setDraft] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const isBaseline = selected === DEFAULT_TYPESET_NAME;

  const startAdd = () => {
    setDraft("");
    setEditing("add");
  };
  const startRename = () => {
    setDraft(selected);
    setEditing("rename");
  };

  const taken = editing === "rename" ? names.filter((n) => n !== selected) : names;
  const trimmed = draft.trim();
  const valid = trimmed.length > 0 && isTypesetName(trimmed) && !taken.includes(trimmed);

  const submit = () => {
    if (!valid) return;
    if (editing === "add") onAdd(trimmed);
    else onRename(selected, trimmed);
    setEditing(null);
  };

  if (editing) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1">
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") setEditing(null);
            }}
            placeholder={editing === "add" ? "New preset name" : "Rename preset"}
            spellCheck={false}
            className="h-7 flex-1 text-xs font-mono"
            aria-label={editing === "add" ? "New preset name" : "Rename preset"}
          />
          <button
            type="button"
            onClick={submit}
            disabled={!valid}
            aria-label="Confirm"
            className="size-7 shrink-0 grid place-items-center rounded-md border border-input bg-background text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            <Check size={13} />
          </button>
          <button
            type="button"
            onClick={() => setEditing(null)}
            aria-label="Cancel"
            className="size-7 shrink-0 grid place-items-center rounded-md text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <X size={13} />
          </button>
        </div>
        <span className="text-[10px] text-muted-foreground/80">
          {trimmed.length > 0 && !valid
            ? taken.includes(trimmed)
              ? `"${trimmed}" already exists`
              : "Letters, digits, dash and underscore only — it becomes a class name"
            : `Becomes .typeset-${trimmed || "name"}`}
        </span>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1">
          <div className="flex-1 min-w-0 flex items-center gap-0.5 p-0.5 rounded-md bg-muted overflow-x-auto">
            {names.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => onSelect(name)}
                aria-pressed={name === selected}
                className={
                  "flex-1 min-w-14 h-6 px-2 grid place-items-center rounded-[5px] text-[11px] truncate cursor-pointer " +
                  (name === selected
                    ? "bg-background font-medium text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                {name}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={startAdd}
            title="New preset"
            aria-label="New preset"
            className="size-7 shrink-0 grid place-items-center rounded-md border border-input bg-background text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <Plus size={13} />
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[10px] text-muted-foreground/80 truncate">
            {isBaseline ? ":root — styles every screen" : `.typeset-${selected}`}
          </span>
          {isBaseline ? null : (
            <>
              <button
                type="button"
                onClick={startRename}
                title={`Rename ${selected}`}
                aria-label={`Rename ${selected}`}
                className="ml-auto text-muted-foreground/60 hover:text-foreground cursor-pointer"
              >
                <Pencil size={11} />
              </button>
              <button
                type="button"
                onClick={() => setConfirmRemove(true)}
                title={`Delete ${selected}`}
                aria-label={`Delete ${selected}`}
                className="text-muted-foreground/60 hover:text-destructive cursor-pointer"
              >
                <Trash2 size={11} />
              </button>
            </>
          )}
        </div>
      </div>
      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{`Delete the "${selected}" typeset`}</AlertDialogTitle>
            <AlertDialogDescription>
              {`Any region still carrying .typeset-${selected} keeps the class but falls back to the default typeset's rhythm.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirmRemove(false);
                onRemove(selected);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
