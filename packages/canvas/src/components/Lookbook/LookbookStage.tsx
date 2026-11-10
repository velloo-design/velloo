import type { LookbookGenerateResult } from "@velloo/protocol";
import {
  activeDirections,
  currentBoard,
  type LookbookBrief,
  type LookbookDirection,
  type LookbookImage,
} from "@velloo/schema";
import {
  Check,
  Hammer,
  MessageSquare,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { lookbook as lookbookApi } from "../../api/lookbook.ts";
import { useCanvas } from "../../store.ts";
import { pushToast, toastError } from "../../toast.ts";
import { EmptyState } from "../EmptyState.tsx";
import { Loading } from "../Loading.tsx";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../ui/card.tsx";
import { Checkbox } from "../ui/checkbox.tsx";
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
import { useLookbookStep } from "./LookbookRail.tsx";
import { dollars, ModelPicker, useModel } from "./ModelPicker.tsx";
import {
  buildFromMock,
  proposeMore,
  reviseDirection,
  START_FROM_APP,
  START_FROM_SCRATCH,
} from "./prompts.ts";

const src = (image: LookbookImage) => `/${image.path}`;

/** Say what a draw produced, cost included: every image is paid for. */
function reportDraw(result: LookbookGenerateResult, noun: string) {
  const made = result.made.length;
  if (result.failed.length > 0) {
    toastError(
      result.failed.map((f) => `${f.direction}: ${f.message}`).join("\n"),
      made > 0 ? `${result.failed.length} ${noun} couldn't be drawn` : `No ${noun} could be drawn`,
    );
  }
  if (made > 0) {
    pushToast({
      kind: "success",
      message: `${made} ${made === 1 ? noun.replace(/s$/, "") : noun} drawn${result.cost ? `: ${result.cost}` : ""}.`,
    });
  }
}

function useDraw() {
  const generate = useCanvas((s) => s.generateLookbook);
  return (body: Parameters<typeof generate>[0], noun: string) =>
    void generate(body)
      .then((r) => reportDraw(r, noun))
      .catch((err) => toastError(err, `Could not draw the ${noun}`));
}

function useBusy(direction: string, kind: "moodboard" | "mock"): boolean {
  const pending = useCanvas((s) =>
    s.lookbook?.pending.some((p) => p.direction === direction && p.kind === kind),
  );
  const local = useCanvas((s) => s.lookbookBusy.includes(direction));
  return Boolean(pending || local);
}

function StepFrame({
  title,
  ask,
  children,
  footer,
}: {
  title: string;
  ask: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl p-6 flex flex-col gap-5">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            <p className="text-sm text-muted-foreground max-w-[70ch]">{ask}</p>
          </div>
          {children}
        </div>
      </div>
      {footer ? (
        <footer className="border-t bg-card">
          <div className="mx-auto w-full max-w-6xl flex flex-wrap items-center gap-2 px-6 py-3">
            {footer}
          </div>
        </footer>
      ) : null}
    </div>
  );
}

// --- Start -----------------------------------------------------------------

function Start() {
  const ask = useCanvas((s) => s.askLookbookAgent);
  const go = (text: string, prompt: string) =>
    void ask({ kind: "note", text }, prompt).catch((err) =>
      toastError(err, "Could not ask the agent"),
    );
  return (
    <div className="flex-1 overflow-y-auto grid place-items-center p-10">
      <div className="w-full max-w-2xl flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">See it before you build it</h1>
          <p className="text-sm text-muted-foreground">
            Your agent writes a brief and three directions. You narrow them down while image models
            draw a mood board for each, then full-page mocks. The mock you choose is what your agent
            builds, with your components and your design's rules.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Redesign a page of this app</CardTitle>
              <CardDescription>
                Your agent reads the page from the code, so every mock carries its real copy.
              </CardDescription>
            </CardHeader>
            <CardFooter>
              <Button size="sm" onClick={() => go("Start from the app", START_FROM_APP)}>
                <Sparkles />
                Start from the app
              </Button>
            </CardFooter>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Start something new</CardTitle>
              <CardDescription>
                Your agent asks what you're building, a few questions at a time, and writes the
                brief from your answers.
              </CardDescription>
            </CardHeader>
            <CardFooter>
              <Button
                size="sm"
                variant="outline"
                onClick={() => go("Start from scratch", START_FROM_SCRATCH)}
              >
                <Plus />
                Start from scratch
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  );
}

// --- Brief -----------------------------------------------------------------

function BriefEditor({
  brief,
  open,
  onClose,
}: {
  brief: LookbookBrief;
  open: boolean;
  onClose: () => void;
}) {
  const update = useCanvas((s) => s.updateLookbook);
  const [draft, setDraft] = useState(brief);
  const field = (key: keyof LookbookBrief) => (e: { target: { value: string } }) =>
    setDraft((d) => ({ ...d, [key]: e.target.value }));
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
          </Field>
          <Field>
            <FieldLabel htmlFor="lb-page">The page</FieldLabel>
            <Input id="lb-page" value={draft.page} onChange={field("page")} />
          </Field>
          <Field>
            <FieldLabel htmlFor="lb-content">Its copy, top to bottom</FieldLabel>
            <Textarea id="lb-content" rows={8} value={draft.content} onChange={field("content")} />
            <FieldDescription>Mocks use exactly this copy.</FieldDescription>
          </Field>
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

function BriefStep() {
  const lookbook = useCanvas((s) => s.lookbook?.lookbook);
  const setStep = useCanvas((s) => s.setLookbookStep);
  const [editing, setEditing] = useState(false);
  const brief = lookbook?.brief;
  if (!brief) {
    return (
      <EmptyState
        title="Your agent is writing the brief"
        hint="It reads the page from the code, or asks what you're building, in the Agent tab or your own terminal. The brief shows here when it lands."
        icon={MessageSquare}
      />
    );
  }
  const rows: [string, string][] = [
    ["The product", brief.product],
    ["The page", brief.page],
    ["Its copy, top to bottom", brief.content],
    ["Notes", brief.notes],
  ];
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
            disabled={!lookbook?.directions.length}
            onClick={() => setStep("directions")}
          >
            {lookbook?.directions.length ? "Continue to the directions" : "Waiting for directions"}
          </Button>
        </>
      }
    >
      <dl className="grid gap-4">
        {rows
          .filter(([, v]) => v.trim())
          .map(([label, value]) => (
            <div key={label} className="grid gap-1">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {label}
              </dt>
              <dd className="whitespace-pre-wrap text-sm">{value}</dd>
            </div>
          ))}
      </dl>
      {editing ? (
        <BriefEditor brief={brief} open={editing} onClose={() => setEditing(false)} />
      ) : null}
    </StepFrame>
  );
}

// --- Directions --------------------------------------------------------------

function DirectionEditor({
  direction,
  onClose,
}: {
  direction: LookbookDirection;
  onClose: () => void;
}) {
  const update = useCanvas((s) => s.updateLookbook);
  const ask = useCanvas((s) => s.askLookbookAgent);
  const [title, setTitle] = useState(direction.title);
  const [description, setDescription] = useState(direction.description);
  const [layout, setLayout] = useState(direction.layout);
  const [request, setRequest] = useState("");
  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{direction.title}</DialogTitle>
          <DialogDescription>
            Edit the words yourself, or tell your agent what to change.
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
              Palette, type, texture, imagery and motifs: what the mood board is drawn from.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="lb-dir-layout">The page in this look</FieldLabel>
            <Textarea
              id="lb-dir-layout"
              rows={3}
              value={layout}
              onChange={(e) => setLayout(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="lb-dir-ask">Or ask your agent</FieldLabel>
            <Textarea
              id="lb-dir-ask"
              rows={2}
              placeholder="Warmer, and less like a magazine"
              value={request}
              onChange={(e) => setRequest(e.target.value)}
            />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="outline"
            disabled={!request.trim()}
            onClick={() =>
              void ask(
                { kind: "revise-direction", direction: direction.id, text: request },
                reviseDirection(direction.title, direction.id, request),
              )
                .then(onClose)
                .catch((err) => toastError(err, "Could not ask the agent"))
            }
          >
            <MessageSquare />
            Ask the agent
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

function DirectionCard({ direction }: { direction: LookbookDirection }) {
  const update = useCanvas((s) => s.updateLookbook);
  const [editing, setEditing] = useState(false);
  const toggle = () =>
    void update({ directions: [{ id: direction.id, dropped: !direction.dropped }] }).catch((err) =>
      toastError(err, "Could not change the direction"),
    );
  return (
    <Card data-direction={direction.id} className={direction.dropped ? "opacity-55" : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {direction.title}
          {direction.dropped ? <Badge variant="outline">Dropped</Badge> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <p className="line-clamp-6">{direction.description}</p>
        {direction.layout ? (
          <p className="line-clamp-3 text-muted-foreground">{direction.layout}</p>
        ) : null}
      </CardContent>
      <CardFooter className="mt-auto gap-1.5">
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          <Pencil />
          Edit
        </Button>
        <Button variant="ghost" size="sm" onClick={toggle}>
          {direction.dropped ? <RotateCcw /> : <X />}
          {direction.dropped ? "Restore" : "Drop"}
        </Button>
      </CardFooter>
      {editing ? <DirectionEditor direction={direction} onClose={() => setEditing(false)} /> : null}
    </Card>
  );
}

function ProposeMore() {
  const ask = useCanvas((s) => s.askLookbookAgent);
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
          void ask(
            {
              kind: "propose-directions",
              text: `${count} more${note.trim() ? `: ${note.trim()}` : ""}`,
            },
            proposeMore(count, note),
          )
            .then(() => setNote(""))
            .catch((err) => toastError(err, "Could not ask the agent"))
        }
      >
        <Sparkles />
        Ask the agent
      </Button>
    </div>
  );
}

function DirectionsStep() {
  const lookbook = useCanvas((s) => s.lookbook?.lookbook);
  const update = useCanvas((s) => s.updateLookbook);
  const setStep = useCanvas((s) => s.setLookbookStep);
  const draw = useDraw();
  const model = useModel("moodboard");
  if (!lookbook) return null;
  const active = activeDirections(lookbook);
  const unboarded = active.filter((d) => d.boards.length === 0);
  return (
    <StepFrame
      title="Directions"
      ask="Drop the ones that aren't you, edit any of them, or ask for more. A mood board is drawn for each one still in the running."
      footer={
        <>
          <span className="text-sm text-muted-foreground">
            {active.length} of {lookbook.directions.length} continue
          </span>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="sm"
            disabled={active.length === 0}
            onClick={() =>
              void update({ skipBoards: true, stage: "mocks" })
                .then(() => setStep("mocks"))
                .catch((err) => toastError(err, "Could not skip the mood boards"))
            }
          >
            Skip mood boards
          </Button>
          <ModelPicker intent="moodboard" />
          <Button
            size="sm"
            disabled={unboarded.length === 0 || !model}
            onClick={() => {
              void update({ skipBoards: false }).then(() => {
                draw({ kind: "moodboard", directions: unboarded.map((d) => d.id) }, "mood boards");
                setStep("boards");
              });
            }}
          >
            <Palette />
            {unboarded.length === 0
              ? "Every direction has a mood board"
              : `Draw ${unboarded.length} mood board${unboarded.length === 1 ? "" : "s"}${model ? ` · ${dollars(model.priceMicros * unboarded.length)}` : ""}`}
          </Button>
        </>
      }
    >
      {lookbook.directions.length === 0 ? (
        <EmptyState
          title="Your agent is proposing directions"
          hint="Three looks that differ from each other and from what you have. They show here as they land."
          icon={Sparkles}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {lookbook.directions.map((d) => (
            <DirectionCard key={d.id} direction={d} />
          ))}
        </div>
      )}
      <ProposeMore />
    </StepFrame>
  );
}

// --- Mood boards -------------------------------------------------------------

function ImageTile({
  image,
  busy,
  tall,
  onOpen,
  children,
}: {
  image: LookbookImage | undefined;
  busy: boolean;
  tall?: boolean;
  onOpen?: () => void;
  children?: ReactNode;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-lg border bg-muted ${tall ? "aspect-[9/16]" : "aspect-[3/2]"}`}
    >
      {image ? (
        <button type="button" className="block size-full cursor-zoom-in" onClick={onOpen}>
          <img
            src={src(image)}
            alt=""
            loading="lazy"
            className={`size-full ${tall ? "object-cover object-top" : "object-cover"}`}
          />
        </button>
      ) : null}
      {busy ? (
        <div className="absolute inset-0 grid place-items-center bg-background/60 backdrop-blur-[1px]">
          <div className="flex items-center gap-2 text-sm">
            <Spinner />
            Drawing…
          </div>
        </div>
      ) : null}
      {children}
    </div>
  );
}

function Lightbox({ image, onClose }: { image: LookbookImage | null; onClose: () => void }) {
  return (
    <Dialog open={image !== null} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-5xl max-h-[92vh] overflow-y-auto p-2">
        <DialogHeader className="sr-only">
          <DialogTitle>Full size</DialogTitle>
          <DialogDescription>The image at full size.</DialogDescription>
        </DialogHeader>
        {image ? <img src={src(image)} alt="" className="w-full rounded" /> : null}
      </DialogContent>
    </Dialog>
  );
}

function BoardCard({
  direction,
  onOpen,
}: {
  direction: LookbookDirection;
  onOpen: (i: LookbookImage) => void;
}) {
  const update = useCanvas((s) => s.updateLookbook);
  const draw = useDraw();
  const busy = useBusy(direction.id, "moodboard");
  const board = currentBoard(direction);
  return (
    <Card data-direction={direction.id} className={direction.picked ? undefined : "opacity-60"}>
      <CardHeader>
        <CardTitle>{direction.title}</CardTitle>
        {direction.boards.length > 1 ? (
          <CardDescription>Version {direction.boards.length}</CardDescription>
        ) : null}
      </CardHeader>
      <CardContent>
        <ImageTile image={board} busy={busy} onOpen={() => board && onOpen(board)}>
          {!board && !busy ? (
            <div className="absolute inset-0 grid place-items-center">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  draw({ kind: "moodboard", directions: [direction.id] }, "mood boards")
                }
              >
                Draw the mood board
              </Button>
            </div>
          ) : null}
        </ImageTile>
      </CardContent>
      <CardFooter className="gap-3">
        <div className="flex items-center gap-2 text-sm">
          <Checkbox
            id={`lb-pick-${direction.id}`}
            checked={direction.picked}
            onCheckedChange={(v) =>
              void update({ directions: [{ id: direction.id, picked: v === true }] }).catch((err) =>
                toastError(err, "Could not change the pick"),
              )
            }
          />
          <label htmlFor={`lb-pick-${direction.id}`}>Continue to mocks</label>
        </div>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => draw({ kind: "moodboard", directions: [direction.id] }, "mood boards")}
        >
          <RefreshCw />
          Regenerate
        </Button>
      </CardFooter>
    </Card>
  );
}

function MockCountPicker() {
  const count = useCanvas((s) => s.lookbook?.lookbook.mockCount ?? 3);
  const update = useCanvas((s) => s.updateLookbook);
  return (
    <NativeSelect
      size="sm"
      aria-label="Mocks per direction"
      value={String(count)}
      onChange={(e) => void update({ mockCount: Number(e.target.value) })}
    >
      {[1, 2, 3, 4, 5, 6].map((n) => (
        <NativeSelectOption key={n} value={String(n)}>
          {n} {n === 1 ? "mock" : "mocks"} each
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

function DrawMocksButton({ label }: { label?: string }) {
  const lookbook = useCanvas((s) => s.lookbook?.lookbook);
  const setStep = useCanvas((s) => s.setLookbookStep);
  const draw = useDraw();
  const model = useModel("mock");
  if (!lookbook) return null;
  const picked = activeDirections(lookbook).filter((d) => d.picked);
  const n = picked.length * lookbook.mockCount;
  return (
    <Button
      size="sm"
      disabled={n === 0 || !model}
      onClick={() => {
        draw({ kind: "mock" }, "mocks");
        setStep("mocks");
      }}
    >
      <Sparkles />
      {n === 0
        ? "Pick a direction to continue"
        : `${label ?? "Draw"} ${n} mock${n === 1 ? "" : "s"}${model ? ` · ${dollars(model.priceMicros * n)}` : ""}`}
    </Button>
  );
}

function BoardsStep() {
  const lookbook = useCanvas((s) => s.lookbook?.lookbook);
  const update = useCanvas((s) => s.updateLookbook);
  const [open, setOpen] = useState<LookbookImage | null>(null);
  if (!lookbook) return null;
  const active = activeDirections(lookbook);
  if (lookbook.skipBoards) {
    return (
      <StepFrame
        title="Mood boards"
        ask="You skipped the mood boards: mocks are drawn from each direction's words alone."
        footer={
          <Button size="sm" variant="outline" onClick={() => void update({ skipBoards: false })}>
            Use mood boards after all
          </Button>
        }
      >
        {null}
      </StepFrame>
    );
  }
  return (
    <StepFrame
      title="Mood boards"
      ask="Regenerate any you'd like another take on, and untick the ones that shouldn't go on. Each picked direction gets mocks drawn from its mood board."
      footer={
        <>
          <span className="text-sm text-muted-foreground">
            {active.filter((d) => d.picked).length} of {active.length} go on to mocks
          </span>
          <div className="flex-1" />
          <MockCountPicker />
          <ModelPicker intent="mock" />
          <DrawMocksButton />
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        {active.map((d) => (
          <BoardCard key={d.id} direction={d} onOpen={setOpen} />
        ))}
      </div>
      <Lightbox image={open} onClose={() => setOpen(null)} />
    </StepFrame>
  );
}

// --- Mocks -------------------------------------------------------------------

function MockRow({
  direction,
  onOpen,
}: {
  direction: LookbookDirection;
  onOpen: (i: LookbookImage) => void;
}) {
  const chosen = useCanvas((s) => s.lookbook?.lookbook.chosen);
  const update = useCanvas((s) => s.updateLookbook);
  const remove = (path: string) =>
    void lookbookApi
      .removeImage(path)
      .then(() => useCanvas.getState().refreshLookbook())
      .catch((err) => toastError(err, "Could not delete the mock"));
  const draw = useDraw();
  const busy = useBusy(direction.id, "mock");
  const board = currentBoard(direction);
  return (
    <section data-direction={direction.id} className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold">{direction.title}</h2>
        {board && direction.mocks.some((m) => m.fromBoard) ? (
          <Badge variant="secondary">From its mood board</Badge>
        ) : null}
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => draw({ kind: "mock", directions: [direction.id], count: 1 }, "mocks")}
        >
          <Plus />
          Draw another
        </Button>
      </div>
      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
        {direction.mocks.map((m) => {
          const isChosen = chosen?.mock === m.path;
          return (
            <div key={m.path} className="flex flex-col gap-1.5">
              <div
                className={
                  isChosen
                    ? "rounded-lg ring-2 ring-primary ring-offset-2 ring-offset-background"
                    : undefined
                }
              >
                <ImageTile image={m} busy={false} tall onOpen={() => onOpen(m)} />
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="xs"
                  variant={isChosen ? "default" : "outline"}
                  onClick={() =>
                    void update({
                      chosen: isChosen ? null : { direction: direction.id, mock: m.path },
                    }).catch((err) => toastError(err, "Could not choose the mock"))
                  }
                >
                  <Check />
                  {isChosen ? "Chosen" : "Choose"}
                </Button>
                <div className="flex-1" />
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Delete this mock"
                  onClick={() => remove(m.path)}
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
          );
        })}
        {busy ? <ImageTile image={undefined} busy tall /> : null}
      </div>
    </section>
  );
}

function MocksStep() {
  const lookbook = useCanvas((s) => s.lookbook?.lookbook);
  const ask = useCanvas((s) => s.askLookbookAgent);
  const update = useCanvas((s) => s.updateLookbook);
  const setStep = useCanvas((s) => s.setLookbookStep);
  const [open, setOpen] = useState<LookbookImage | null>(null);
  if (!lookbook) return null;
  const picked = activeDirections(lookbook).filter((d) => d.picked);
  const anyMocks = picked.some((d) => d.mocks.length > 0);
  const chosen = lookbook.chosen;
  const chosenTitle = lookbook.directions.find((d) => d.id === chosen?.direction)?.title ?? "";
  return (
    <StepFrame
      title="Mocks"
      ask="Open any mock at full size, draw more of a direction you like, and choose the one to build. Its layout, type and colour are what your agent builds; its facts are sample data."
      footer={
        <>
          {anyMocks ? null : (
            <>
              <MockCountPicker />
              <ModelPicker intent="mock" />
              <DrawMocksButton />
            </>
          )}
          <div className="flex-1" />
          <Button
            size="sm"
            disabled={!chosen}
            onClick={() => {
              if (!chosen) return;
              void update({ stage: "build" })
                .then(() =>
                  ask(
                    {
                      kind: "build",
                      direction: chosen.direction,
                      mock: chosen.mock,
                      text: "Build from the chosen mock",
                    },
                    buildFromMock(chosenTitle, chosen.mock),
                  ),
                )
                .then(() => setStep("build"))
                .catch((err) => toastError(err, "Could not hand the mock to the agent"));
            }}
          >
            <Hammer />
            {chosen ? "Build from this mock" : "Choose a mock to build"}
          </Button>
        </>
      }
    >
      {picked.length === 0 ? (
        <EmptyState
          title="No direction is picked"
          hint="Go back to the mood boards and tick one."
        />
      ) : (
        picked.map((d) => <MockRow key={d.id} direction={d} onOpen={setOpen} />)
      )}
      <Lightbox image={open} onClose={() => setOpen(null)} />
    </StepFrame>
  );
}

// --- Build -------------------------------------------------------------------

function BuildStep() {
  const lookbook = useCanvas((s) => s.lookbook?.lookbook);
  const close = useCanvas((s) => s.closeLookbook);
  const ask = useCanvas((s) => s.askLookbookAgent);
  if (!lookbook?.chosen) {
    return <EmptyState title="No mock is chosen yet" hint="Choose one on the Mocks step." />;
  }
  const chosen = lookbook.chosen;
  const direction = lookbook.directions.find((d) => d.id === chosen.direction);
  const mock = direction?.mocks.find((m) => m.path === chosen.mock);
  return (
    <StepFrame
      title="Build"
      ask="Your agent composes this mock as a screen on the canvas, from your app's components and your design's rules, and checks it against the mock. The screen shows up on a board as it lands."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={close}>
            Go to the boards
          </Button>
          <div className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void ask(
                {
                  kind: "build",
                  direction: chosen.direction,
                  mock: chosen.mock,
                  text: "Build from the chosen mock",
                },
                buildFromMock(direction?.title ?? "", chosen.mock),
              ).catch((err) => toastError(err, "Could not ask the agent"))
            }
          >
            <Hammer />
            Ask the agent again
          </Button>
        </>
      }
    >
      <div className="grid gap-6 md:grid-cols-[minmax(0,420px)_1fr] items-start">
        {mock ? (
          <img src={src(mock)} alt="The chosen mock" className="w-full rounded-lg border" />
        ) : null}
        <div className="flex flex-col gap-2 text-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Direction
          </div>
          <div className="font-medium">{direction?.title}</div>
          <p className="text-muted-foreground">{direction?.description}</p>
        </div>
      </div>
    </StepFrame>
  );
}

/** The main area while the lookbook is open: the step the rail has selected. */
export function LookbookStage() {
  const state = useCanvas((s) => s.lookbook);
  const step = useLookbookStep();
  if (!state) {
    return (
      <div className="flex-1 grid place-items-center">
        <Loading size={36} />
      </div>
    );
  }
  if (!state.started) return <Start />;
  switch (step) {
    case "brief":
      return <BriefStep />;
    case "directions":
      return <DirectionsStep />;
    case "boards":
      return <BoardsStep />;
    case "mocks":
      return <MocksStep />;
    case "build":
      return <BuildStep />;
  }
}
