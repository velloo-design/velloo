import { SKETCHBOOK_LIMITS } from "@velloo/protocol";
import { activeDirections } from "@velloo/schema";
import { Shuffle } from "lucide-react";
import { useState } from "react";
import { useCanvas } from "../../store.ts";
import { pushToast, toastError } from "../../toast.ts";
import { Button } from "../ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.tsx";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "../ui/field.tsx";
import { Input } from "../ui/input.tsx";
import { NativeSelect, NativeSelectOption } from "../ui/native-select.tsx";
import { Textarea } from "../ui/textarea.tsx";

/** What a remix takes until the person says otherwise. */
const defaultTake = (a: string, b: string) => `colour from ${a}, type and texture from ${b}`;

/**
 * Make a direction from two others: what to take from each, in words. Its
 * mood board is drawn from both of theirs.
 */
function RemixDialog({ onClose }: { onClose: () => void }) {
  const sketchbook = useCanvas((s) => s.sketchbook?.sketchbook);
  const update = useCanvas((s) => s.updateSketchbook);
  const active = sketchbook ? activeDirections(sketchbook) : [];
  const [a, setA] = useState(active[0]?.id ?? "");
  const [b, setB] = useState(active[1]?.id ?? "");
  const titleOf = (id: string) => active.find((d) => d.id === id)?.title ?? id;
  const [take, setTake] = useState(defaultTake(titleOf(a), titleOf(b)));
  const [edited, setEdited] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const pick = (which: "a" | "b", id: string) => {
    const nextA = which === "a" ? id : a;
    const nextB = which === "b" ? id : b;
    if (which === "a") setA(id);
    else setB(id);
    if (!edited) setTake(defaultTake(titleOf(nextA), titleOf(nextB)));
  };
  const ready = a !== "" && b !== "" && a !== b && take.trim() !== "" && !busy;
  const go = async () => {
    setBusy(true);
    try {
      await update({
        remix: {
          from: [a, b],
          take: take.trim(),
          ...(title.trim() ? { title: title.trim() } : {}),
        },
      });
      pushToast({
        kind: "success",
        message: `Remixed ${titleOf(a)} and ${titleOf(b)}. Draw its mood board to see it.`,
      });
      onClose();
    } catch (err) {
      toastError(err, "Could not remix the directions");
    } finally {
      setBusy(false);
    }
  };
  const select = (which: "a" | "b", value: string) => (
    <NativeSelect
      size="sm"
      aria-label={which === "a" ? "First direction" : "Second direction"}
      value={value}
      onChange={(e) => pick(which, e.target.value)}
    >
      {active.map((d) => (
        <NativeSelectOption key={d.id} value={d.id}>
          {d.title}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Remix two directions</DialogTitle>
          <DialogDescription>
            A new direction from two of these, taking what you say from each. Its mood board is
            drawn from both of theirs.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {select("a", a)}
            <span className="text-muted-foreground">with</span>
            {select("b", b)}
          </div>
          <Field>
            <FieldLabel htmlFor="sketchbook-remix-take">Take</FieldLabel>
            <Textarea
              id="sketchbook-remix-take"
              rows={2}
              maxLength={SKETCHBOOK_LIMITS.take}
              value={take}
              onChange={(e) => {
                setEdited(true);
                setTake(e.target.value);
              }}
            />
            <FieldDescription>
              What comes from each: colour, type, texture, imagery, layout.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="sketchbook-remix-title">Name (optional)</FieldLabel>
            <Input
              id="sketchbook-remix-title"
              placeholder={`${titleOf(a)} × ${titleOf(b)}`}
              maxLength={80}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!ready} onClick={() => void go()}>
            <Shuffle />
            Remix
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Open the remix dialog; there is nothing to remix with fewer than two directions. */
export function RemixButton() {
  const count = useCanvas((s) =>
    s.sketchbook ? activeDirections(s.sketchbook.sketchbook).length : 0,
  );
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" disabled={count < 2} onClick={() => setOpen(true)}>
        <Shuffle />
        Remix two
      </Button>
      {open ? <RemixDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}
