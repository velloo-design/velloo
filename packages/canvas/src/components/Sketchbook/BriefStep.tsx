import { SKETCHBOOK_LIMITS } from "@velloo/protocol";
import type { SketchbookBrief } from "@velloo/schema";
import { MessageSquare, Pencil } from "lucide-react";
import { useState } from "react";
import { useCanvas } from "../../store.ts";
import { toastError } from "../../toast.ts";
import { EmptyState } from "../EmptyState.tsx";
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
import { Textarea } from "../ui/textarea.tsx";
import { BriefView } from "./BriefView.tsx";
import { ReferencesPanel } from "./References.tsx";
import { StepFrame } from "./stage-parts.tsx";

function BriefEditor({
  brief,
  open,
  look,
  onClose,
}: {
  brief: SketchbookBrief;
  open: boolean;
  /** A Look's brief has no page or copy. */
  look: boolean;
  onClose: () => void;
}) {
  const update = useCanvas((s) => s.updateSketchbook);
  const [draft, setDraft] = useState(brief);
  const field = (key: keyof SketchbookBrief) => (e: { target: { value: string } }) =>
    setDraft((d) => ({ ...d, [key]: e.target.value }));
  const count = (key: keyof typeof SKETCHBOOK_LIMITS) => {
    const n = draft[key as keyof SketchbookBrief].length;
    const limit = SKETCHBOOK_LIMITS[key];
    return (
      <span className={`tabular-nums ${n > limit ? "text-destructive" : ""}`}>
        {n.toLocaleString()} / {limit.toLocaleString()}
      </span>
    );
  };
  const over = (["product", "page", "content", "notes"] as const).some(
    (k) => draft[k].length > SKETCHBOOK_LIMITS[k],
  );
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit the brief</DialogTitle>
          <DialogDescription>Every image is drawn from these words.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="lb-product">The product</FieldLabel>
            <Textarea id="lb-product" rows={3} value={draft.product} onChange={field("product")} />
            <FieldDescription>{count("product")}</FieldDescription>
          </Field>
          {look ? null : (
            <>
              <Field>
                <FieldLabel htmlFor="lb-page">The page</FieldLabel>
                <Input id="lb-page" value={draft.page} onChange={field("page")} />
              </Field>
              <Field>
                <FieldLabel htmlFor="lb-content">Its copy, top to bottom</FieldLabel>
                <Textarea
                  id="lb-content"
                  rows={10}
                  value={draft.content}
                  onChange={field("content")}
                />
                <FieldDescription>
                  Mocks use exactly this copy. Keep every heading, button and label; shorten long
                  paragraphs and lists. {count("content")}
                </FieldDescription>
              </Field>
            </>
          )}
          <Field>
            <FieldLabel htmlFor="lb-notes">Notes</FieldLabel>
            <Textarea id="lb-notes" rows={2} value={draft.notes} onChange={field("notes")} />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={over}
            onClick={() =>
              void update({ brief: draft })
                .then(onClose)
                .catch((err) => toastError(err, "Could not save the brief"))
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BriefStep() {
  const sketchbook = useCanvas((s) => s.sketchbook?.sketchbook);
  const setStep = useCanvas((s) => s.setSketchbookStep);
  const [editing, setEditing] = useState(false);
  const brief = sketchbook?.brief;
  if (!brief) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto">
        <EmptyState
          title="Your agent is writing the brief"
          hint={
            sketchbook?.subject === "look"
              ? "It reads what the product is, and asks you the mood you're after: answer it in the Agent tab. The brief shows here as soon as it's written."
              : "It reads the page from the code, or asks you what you're building: answer it in the Agent tab. The brief shows here as soon as it's written."
          }
          icon={MessageSquare}
        />
        <div className="mx-auto w-full max-w-6xl px-6 pb-6">
          <ReferencesPanel />
        </div>
      </div>
    );
  }
  return (
    <StepFrame
      title="The brief"
      ask="What every direction is drawn for. Change anything that's wrong before the images are drawn: they use it word for word."
      footer={
        <>
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil />
            Edit
          </Button>
          <div className="flex-1" />
          <Button
            size="sm"
            disabled={!sketchbook?.directions.length}
            onClick={() => setStep("directions")}
          >
            {sketchbook?.directions.length
              ? "Continue to the directions"
              : "Waiting for directions"}
          </Button>
        </>
      }
    >
      <BriefView brief={brief} look={sketchbook?.subject === "look"} />
      <ReferencesPanel />
      {editing ? (
        <BriefEditor
          brief={brief}
          open={editing}
          look={sketchbook?.subject === "look"}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </StepFrame>
  );
}
