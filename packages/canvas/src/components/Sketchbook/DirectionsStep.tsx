import { activeDirections, type SketchbookDirection } from "@velloo/schema";
import { Check, MessageSquare, Pencil, Sparkles } from "lucide-react";
import { useState } from "react";
import { useCanvas } from "../../store.ts";
import { toastError } from "../../toast.ts";
import { EmptyState } from "../EmptyState.tsx";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "../ui/card.tsx";
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
import { Spinner } from "../ui/spinner.tsx";
import { Textarea } from "../ui/textarea.tsx";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group.tsx";
import { HexText } from "./HexText.tsx";
import { InspirationPicker } from "./InspirationPicker.tsx";
import { ProposalPanel } from "./ProposalPanel.tsx";
import { proposeMore, reviseDirection } from "./prompts.ts";
import { DirectionReferences } from "./References.tsx";
import { RemixButton } from "./Remix.tsx";
import { MakeLookButton, RemixOf, StepFrame } from "./stage-parts.tsx";

/** Edit a direction's words: its name, its look, and its page. */
function DirectionEditor({
  direction,
  onClose,
}: {
  direction: SketchbookDirection;
  onClose: () => void;
}) {
  const update = useCanvas((s) => s.updateSketchbook);
  const [title, setTitle] = useState(direction.title);
  const [description, setDescription] = useState(direction.description);
  const [layout, setLayout] = useState(direction.layout);
  const look = useCanvas((s) => s.sketchbook?.sketchbook.subject === "look");
  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit “{direction.title}”</DialogTitle>
          <DialogDescription>
            Every image of this direction is drawn from these words. Its tokens stay as they are:
            ask your agent to revise them.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="lb-dir-title">Name</FieldLabel>
            <Input id="lb-dir-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="lb-dir-desc">The look</FieldLabel>
            <Textarea
              id="lb-dir-desc"
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <FieldDescription>
              Palette, type, texture, imagery and motifs: what the inspiration is drawn from.
            </FieldDescription>
          </Field>
          {look ? null : (
            <Field>
              <FieldLabel htmlFor="lb-dir-layout">The page in this look</FieldLabel>
              <Textarea
                id="lb-dir-layout"
                rows={3}
                value={layout}
                onChange={(e) => setLayout(e.target.value)}
              />
            </Field>
          )}
        </FieldGroup>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!title.trim() || !description.trim()}
            onClick={() =>
              void update({ directions: [{ id: direction.id, title, description, layout }] })
                .then(onClose)
                .catch((err) => toastError(err, "Could not save the direction"))
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Ask the agent to revise a direction, its words and its tokens, in the person's words. */
function ReviseDirectionDialog({
  direction,
  onClose,
}: {
  direction: SketchbookDirection;
  onClose: () => void;
}) {
  const ask = useCanvas((s) => s.askSketchbookAgent);
  const [request, setRequest] = useState("");
  const send = () => {
    if (!request.trim()) return;
    void ask(reviseDirection(direction.title, request))
      .then(onClose)
      .catch((err) => toastError(err, "Could not ask the agent"));
  };
  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Revise “{direction.title}”</DialogTitle>
          <DialogDescription>
            Your agent rewrites the direction and its tokens to match, and the card updates when it
            does.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="lb-dir-ask">What to change</FieldLabel>
          <Textarea
            id="lb-dir-ask"
            rows={3}
            autoFocus
            placeholder="Warmer, and less like a magazine; a rounder sans for the body"
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
            }}
          />
        </Field>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!request.trim()} onClick={send}>
            <MessageSquare />
            Ask the agent
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Where a direction's tokens will be, while the agent is still proposing them. */
function TokensPending() {
  return (
    <div
      data-tokens-pending
      className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center"
    >
      <Spinner className="text-muted-foreground" />
      <p className="text-sm font-medium">Your agent is proposing tokens</p>
      <p className="max-w-xs text-xs text-muted-foreground">
        Colours for light and dark, corners and a font pairing, shown here on your own components
        once they land.
      </p>
    </div>
  );
}

/** One direction: its words beside its tokens on the design's components, kept or dropped. */
function DirectionCard({ direction }: { direction: SketchbookDirection }) {
  const id = useCanvas((s) => s.sketchbookId);
  const version = useCanvas((s) => s.sketchbook?.sketchbook.updatedAt ?? "");
  const update = useCanvas((s) => s.updateSketchbook);
  const [editing, setEditing] = useState<"words" | "revise" | null>(null);
  const kept = !direction.dropped && direction.picked;
  const keep = (on: boolean) =>
    void update({
      directions: [
        { id: direction.id, picked: on, ...(on && direction.dropped && { dropped: false }) },
      ],
    }).catch((err) => toastError(err, "Could not change the direction"));
  return (
    <Card data-direction={direction.id} data-kept={kept}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {direction.title}
          {kept ? null : <Badge variant="outline">Dropped</Badge>}
        </CardTitle>
        <RemixOf direction={direction} />
      </CardHeader>
      <CardContent
        className={`grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] ${kept ? "" : "opacity-60"}`}
      >
        <div className="flex min-w-0 flex-col gap-3 text-sm">
          <p className="leading-relaxed">
            <HexText
              text={direction.description}
              onChange={(description) =>
                void update({ directions: [{ id: direction.id, description }] }).catch((err) =>
                  toastError(err, "Could not change the colour"),
                )
              }
            />
          </p>
          {direction.layout ? <p className="text-muted-foreground">{direction.layout}</p> : null}
          <DirectionReferences direction={direction} />
        </div>
        {direction.proposal && id ? (
          <ProposalPanel
            sketchbookId={id}
            direction={direction.id}
            proposal={direction.proposal}
            version={version}
          />
        ) : (
          <TokensPending />
        )}
      </CardContent>
      <CardFooter className="flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => setEditing("words")}>
          <Pencil />
          Edit words
        </Button>
        <Button variant="outline" size="sm" onClick={() => setEditing("revise")}>
          <MessageSquare />
          Ask to revise
        </Button>
        <div className="flex-1" />
        <MakeLookButton direction={direction} variant="secondary" />
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          aria-label={`Keep or drop ${direction.title}`}
          value={kept ? "keep" : "drop"}
          onValueChange={(v) => (v === "keep" || v === "drop" ? keep(v === "keep") : null)}
        >
          <ToggleGroupItem
            value="keep"
            className="px-3! data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary/90"
          >
            {kept ? <Check /> : null}
            Keep
          </ToggleGroupItem>
          <ToggleGroupItem
            value="drop"
            className="px-3! data-[state=on]:bg-muted data-[state=on]:text-muted-foreground"
          >
            Drop
          </ToggleGroupItem>
        </ToggleGroup>
      </CardFooter>
      {editing === "words" ? (
        <DirectionEditor direction={direction} onClose={() => setEditing(null)} />
      ) : editing === "revise" ? (
        <ReviseDirectionDialog direction={direction} onClose={() => setEditing(null)} />
      ) : null}
    </Card>
  );
}

function ProposeMore() {
  const ask = useCanvas((s) => s.askSketchbookAgent);
  const [count, setCount] = useState(2);
  const [note, setNote] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-3">
      <span className="text-sm">Propose</span>
      <NativeSelect
        size="sm"
        aria-label="How many"
        value={String(count)}
        onChange={(e) => setCount(Number(e.target.value))}
      >
        {[1, 2, 3].map((n) => (
          <NativeSelectOption key={n} value={String(n)}>
            {n} more
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <Input
        className="h-7 flex-1 min-w-48"
        placeholder="Anything they should be (optional): darker, more playful, closer to the second one"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <Button
        size="sm"
        variant="outline"
        onClick={() =>
          void ask(proposeMore(count, note))
            .then(() => setNote(""))
            .catch((err) => toastError(err, "Could not ask the agent"))
        }
      >
        <Sparkles />
        Ask the agent
      </Button>
      <RemixButton />
    </div>
  );
}

/**
 * The directions with their tokens, one card each, kept or dropped; the
 * footer picks the inspiration to draw for the kept ones, or skips on.
 */
export function DirectionsStep() {
  const sketchbook = useCanvas((s) => s.sketchbook?.sketchbook);
  if (!sketchbook) return null;
  const active = activeDirections(sketchbook);
  const kept = active.filter((d) => d.picked).length;
  return (
    <StepFrame
      title="Directions"
      ask={`Each direction in words and in tokens on your own components. Keep the ones worth taking further (${kept} of ${sketchbook.directions.length} kept), edit them or ask for changes, then draw inspiration for the kept ones, or skip ahead.`}
      footer={<InspirationPicker />}
    >
      {sketchbook.directions.length === 0 ? (
        <EmptyState
          title="Your agent is proposing directions"
          hint="Three looks that differ from each other and from what you have, each with its tokens. They show here as they land."
          icon={Sparkles}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {sketchbook.directions.map((d) => (
            <DirectionCard key={d.id} direction={d} />
          ))}
        </div>
      )}
      <ProposeMore />
    </StepFrame>
  );
}
