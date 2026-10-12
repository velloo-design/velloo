import { normalizeThemeName, themeNameProblem } from "@velloo/schema";
import { useState } from "react";
import { useCanvas } from "../store.ts";
import { toastError } from "../toast.ts";
import { themeLabel } from "./theme-label.ts";
import { Button } from "./ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.tsx";
import { Field, FieldDescription, FieldError, FieldLabel } from "./ui/field.tsx";
import { Input } from "./ui/input.tsx";

interface Props {
  /** The theme the new one starts as a copy of. */
  from: string;
  /** Every theme the design has, for the name check. */
  existing: readonly string[];
  onClose(): void;
}

/**
 * Naming a theme is the one decision that has to come before it exists; the
 * rest — colour, type, shape — is made in the design-language flow this leads
 * into, on a specimen, with Cancel there discarding the theme again.
 */
export function NewThemeDialog({ from, existing, onClose }: Props) {
  const startTheme = useCanvas((s) => s.startTheme);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const name = normalizeThemeName(draft);
  const problem = themeNameProblem(name, existing);
  // An empty box is not a mistake yet — only what has been typed is judged.
  const shown = name === "" ? null : problem;

  const create = async () => {
    if (problem || busy) return;
    setBusy(true);
    try {
      await startTheme(name);
      onClose();
    } catch (err) {
      toastError(err, "Could not create the theme");
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent data-testid="new-theme" className="sm:max-w-md">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <DialogHeader>
            <DialogTitle>New theme</DialogTitle>
            <DialogDescription>
              It starts as a copy of {themeLabel(from)}. Next you choose its colour, type and shape;
              this board switches to it when you are done.
            </DialogDescription>
          </DialogHeader>
          <Field data-invalid={shown ? true : undefined}>
            <FieldLabel htmlFor="new-theme-name">Name</FieldLabel>
            <Input
              id="new-theme-name"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              value={draft}
              placeholder="Night"
              aria-invalid={shown ? true : undefined}
              aria-describedby="new-theme-name-help"
              onChange={(e) => setDraft(e.target.value)}
            />
            {shown ? (
              <FieldError id="new-theme-name-help">{shown}</FieldError>
            ) : (
              <FieldDescription id="new-theme-name-help">
                Saved as theme/{name || "Night"}.json — the name your agent uses for it too.
              </FieldDescription>
            )}
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={problem !== null || busy}>
              Create and define
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
