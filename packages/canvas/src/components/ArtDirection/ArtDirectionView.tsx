import {
  ART_DIRECTION_LIMITS,
  type ArtDirectionGenerateResult,
  describeArtDirectionFailures,
} from "@velloo/protocol";
import {
  type ArtDirectionBrief,
  type ArtDirectionDirection,
  type ArtDirectionImage,
  type ArtDirectionPage,
  activeDirections,
  currentBoard,
} from "@velloo/schema";
import {
  Check,
  CircleAlert,
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
import { artDirection as artDirectionApi } from "../../api/art-direction.ts";
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
import { AgentChoices } from "./AgentChoices.tsx";
import { ArtDirectionMark } from "./ArtDirectionMark.tsx";
import { useArtDirectionStep } from "./ArtDirectionRail.tsx";
import { BriefView } from "./BriefView.tsx";
import { ChoiceCards } from "./ChoiceCards.tsx";
import { HexText } from "./HexText.tsx";
import { dollars, ModelPicker, useModel } from "./ModelPicker.tsx";
import { PagePicker } from "./PagePicker.tsx";
import {
  BUILD_FROM_MOCK,
  proposeMore,
  reviseDirection,
  START_FROM_APP,
  START_FROM_SCRATCH,
} from "./prompts.ts";

const src = (image: ArtDirectionImage) => `/${image.path}`;

/** Say what a draw produced, cost included: every image is paid for. */
function reportDraw(result: ArtDirectionGenerateResult, noun: string) {
  const made = result.made.length;
  if (result.failed.length > 0) {
    const titles = new Map(
      useCanvas.getState().artDirection?.artDirection.directions.map((d) => [d.id, d.title]) ?? [],
    );
    toastError(
      describeArtDirectionFailures(result.failed, (id) => titles.get(id) ?? id),
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
  const generate = useCanvas((s) => s.generateArtDirection);
  return (body: Parameters<typeof generate>[0], noun: string) =>
    void generate(body)
      .then((r) => reportDraw(r, noun))
      .catch((err) => toastError(err, `Could not draw the ${noun}`));
}

function useBusy(direction: string, kind: "moodboard" | "mock"): boolean {
  const pending = useCanvas((s) =>
    s.artDirection?.pending.some((p) => p.direction === direction && p.kind === kind),
  );
  const local = useCanvas((s) => s.artDirectionBusy.includes(direction));
  return Boolean(pending || local);
}

/** Why a direction's last draw failed, where its image would be. */
function Failure({ message }: { message: string }) {
  return (
    <p className="flex max-w-md items-start gap-1.5 text-left text-xs text-destructive">
      <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
      {message}
    </p>
  );
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
  const update = useCanvas((s) => s.updateArtDirection);
  const [origin, setOrigin] = useState<"existing" | "new">("existing");
  const [page, setPage] = useState<ArtDirectionPage | null>(null);
  const options = [
    {
      value: "existing" as const,
      title: "Redesign a page of this app",
      body: "Your agent reads the page from the code, so every mock carries its real copy.",
    },
    {
      value: "new" as const,
      title: "Start something new",
      body: "Your agent asks what you're building, a few questions at a time, and writes the brief from your answers.",
    },
  ];
  return (
    <div className="flex-1 overflow-y-auto grid place-items-center p-10">
      <div className="w-full max-w-2xl flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <ArtDirectionMark className="size-10" />
          <h1 className="text-2xl font-semibold tracking-tight">See it before you build it</h1>
          <p className="text-sm text-muted-foreground">
            Your agent writes a brief and three directions. You narrow them down while image models
            draw a mood board for each, then full-page mocks. The mock you choose is what your agent
            builds, with your components and your design's rules.
          </p>
        </div>
        <ChoiceCards
          label="What to direct"
          className="grid gap-3 sm:grid-cols-2"
          value={origin}
          options={options}
          onChange={setOrigin}
        />
        {origin === "existing" ? <PagePicker onChange={setPage} /> : null}
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Run it with</h2>
          <AgentChoices
            prompt={origin === "existing" ? START_FROM_APP : START_FROM_SCRATCH}
            onStart={() =>
              update({ stage: "brief", origin, page: origin === "existing" ? page : null })
            }
          />
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
  brief: ArtDirectionBrief;
  open: boolean;
  onClose: () => void;
}) {
  const update = useCanvas((s) => s.updateArtDirection);
  const [draft, setDraft] = useState(brief);
  const field = (key: keyof ArtDirectionBrief) => (e: { target: { value: string } }) =>
    setDraft((d) => ({ ...d, [key]: e.target.value }));
  const count = (key: keyof typeof ART_DIRECTION_LIMITS) => {
    const n = draft[key as keyof ArtDirectionBrief].length;
    const limit = ART_DIRECTION_LIMITS[key];
    return (
      <span className={`tabular-nums ${n > limit ? "text-destructive" : ""}`}>
        {n.toLocaleString()} / {limit.toLocaleString()}
      </span>
    );
  };
  const over = (["product", "page", "content", "notes"] as const).some(
    (k) => draft[k].length > ART_DIRECTION_LIMITS[k],
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
          <Field>
            <FieldLabel htmlFor="lb-page">The page</FieldLabel>
            <Input id="lb-page" value={draft.page} onChange={field("page")} />
          </Field>
          <Field>
            <FieldLabel htmlFor="lb-content">Its copy, top to bottom</FieldLabel>
            <Textarea id="lb-content" rows={10} value={draft.content} onChange={field("content")} />
            <FieldDescription>
              Mocks use exactly this copy. Keep every heading, button and label; shorten long
              paragraphs and lists. {count("content")}
            </FieldDescription>
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

function BriefStep() {
  const artDirection = useCanvas((s) => s.artDirection?.artDirection);
  const setStep = useCanvas((s) => s.setArtDirectionStep);
  const [editing, setEditing] = useState(false);
  const brief = artDirection?.brief;
  if (!brief) {
    return (
      <EmptyState
        title="Your agent is writing the brief"
        hint="It reads the page from the code, or asks you what you're building: answer it in the Agent tab. The brief shows here as soon as it's written."
        icon={MessageSquare}
      />
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
            disabled={!artDirection?.directions.length}
            onClick={() => setStep("directions")}
          >
            {artDirection?.directions.length
              ? "Continue to the directions"
              : "Waiting for directions"}
          </Button>
        </>
      }
    >
      <BriefView brief={brief} />
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
  direction: ArtDirectionDirection;
  onClose: () => void;
}) {
  const update = useCanvas((s) => s.updateArtDirection);
  const ask = useCanvas((s) => s.askArtDirectionAgent);
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
              void ask(reviseDirection(direction.title, request))
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

function DirectionCard({ direction }: { direction: ArtDirectionDirection }) {
  const update = useCanvas((s) => s.updateArtDirection);
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
  const ask = useCanvas((s) => s.askArtDirectionAgent);
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
    </div>
  );
}

function DirectionsStep() {
  const artDirection = useCanvas((s) => s.artDirection?.artDirection);
  const update = useCanvas((s) => s.updateArtDirection);
  const setStep = useCanvas((s) => s.setArtDirectionStep);
  const draw = useDraw();
  const model = useModel("moodboard");
  if (!artDirection) return null;
  const active = activeDirections(artDirection);
  const unboarded = active.filter((d) => d.boards.length === 0);
  return (
    <StepFrame
      title="Directions"
      ask="Drop the ones that aren't you, edit any of them, or ask for more. A mood board is drawn for each one still in the running."
      footer={
        <>
          <span className="text-sm text-muted-foreground">
            {active.length} of {artDirection.directions.length} continue
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
      {artDirection.directions.length === 0 ? (
        <EmptyState
          title="Your agent is proposing directions"
          hint="Three looks that differ from each other and from what you have. They show here as they land."
          icon={Sparkles}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {artDirection.directions.map((d) => (
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
  image: ArtDirectionImage | undefined;
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

function Lightbox({ image, onClose }: { image: ArtDirectionImage | null; onClose: () => void }) {
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
  direction: ArtDirectionDirection;
  onOpen: (i: ArtDirectionImage) => void;
}) {
  const update = useCanvas((s) => s.updateArtDirection);
  const draw = useDraw();
  const busy = useBusy(direction.id, "moodboard");
  const failure = useCanvas((s) => s.artDirectionFailures[direction.id]);
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
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
              {failure ? <Failure message={failure} /> : null}
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  draw({ kind: "moodboard", directions: [direction.id] }, "mood boards")
                }
              >
                {failure ? "Try again" : "Draw the mood board"}
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
  const count = useCanvas((s) => s.artDirection?.artDirection.mockCount ?? 3);
  const update = useCanvas((s) => s.updateArtDirection);
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
  const artDirection = useCanvas((s) => s.artDirection?.artDirection);
  const setStep = useCanvas((s) => s.setArtDirectionStep);
  const draw = useDraw();
  const model = useModel("mock");
  if (!artDirection) return null;
  const picked = activeDirections(artDirection).filter((d) => d.picked);
  const n = picked.length * artDirection.mockCount;
  // Mocks are drawn from each direction's mood board: one without it waits.
  const unboarded = artDirection.skipBoards ? [] : picked.filter((d) => !currentBoard(d));
  if (unboarded.length > 0) {
    return (
      <Button size="sm" disabled>
        {unboarded.length === 1
          ? `"${unboarded[0]?.title}" needs its mood board first`
          : `${unboarded.length} directions need their mood boards first`}
      </Button>
    );
  }
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
  const artDirection = useCanvas((s) => s.artDirection?.artDirection);
  const update = useCanvas((s) => s.updateArtDirection);
  const [open, setOpen] = useState<ArtDirectionImage | null>(null);
  if (!artDirection) return null;
  const active = activeDirections(artDirection);
  if (artDirection.skipBoards) {
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
  direction: ArtDirectionDirection;
  onOpen: (i: ArtDirectionImage) => void;
}) {
  const chosen = useCanvas((s) => s.artDirection?.artDirection.chosen);
  const update = useCanvas((s) => s.updateArtDirection);
  const remove = (path: string) =>
    void artDirectionApi
      .removeImage(path)
      .then(() => useCanvas.getState().refreshArtDirection())
      .catch((err) => toastError(err, "Could not delete the mock"));
  const draw = useDraw();
  const busy = useBusy(direction.id, "mock");
  const failure = useCanvas((s) => s.artDirectionFailures[direction.id]);
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
      {failure && !busy ? <Failure message={failure} /> : null}
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
  const artDirection = useCanvas((s) => s.artDirection?.artDirection);
  const [open, setOpen] = useState<ArtDirectionImage | null>(null);
  const [building, setBuilding] = useState(false);
  if (!artDirection) return null;
  const picked = activeDirections(artDirection).filter((d) => d.picked);
  const anyMocks = picked.some((d) => d.mocks.length > 0);
  const chosen = artDirection.chosen;
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
          <Button size="sm" disabled={!chosen} onClick={() => setBuilding(true)}>
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
      {building && chosen ? <BuildDialog onClose={() => setBuilding(false)} /> : null}
    </StepFrame>
  );
}

/**
 * Hand the chosen mock to the agent, after asking the one thing only the
 * person can decide: whether the build may spend credits drawing the
 * photographs and illustrations the mock shows.
 */
function BuildDialog({ onClose }: { onClose: () => void }) {
  const update = useCanvas((s) => s.updateArtDirection);
  const ask = useCanvas((s) => s.askArtDirectionAgent);
  const setStep = useCanvas((s) => s.setArtDirectionStep);
  const asked = useCanvas((s) => s.artDirection?.artDirection.generateImages ?? null);
  const [images, setImages] = useState<boolean>(asked ?? false);
  const build = () =>
    void update({ stage: "build", generateImages: images })
      .then(() => ask(BUILD_FROM_MOCK))
      .then(() => {
        setStep("build");
        onClose();
      })
      .catch((err) => toastError(err, "Could not hand the mock to the agent"));
  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Build from this mock</DialogTitle>
          <DialogDescription>
            Your agent composes it from your components and your design's rules.
          </DialogDescription>
        </DialogHeader>
        <ChoiceCards
          label="Images"
          className="flex flex-col gap-2"
          value={images ? "yes" : "no"}
          options={[
            {
              value: "yes",
              title: "Generate the images it shows",
              body: "Photographs and illustrations drawn to match the mock, paid from your credits (about $0.04 each).",
            },
            {
              value: "no",
              title: "No generated images",
              body: "Your agent draws simple art itself, or leaves clear placeholders for your own.",
            },
          ]}
          onChange={(v) => setImages(v === "yes")}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={build}>
            <Hammer />
            Build it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Build -------------------------------------------------------------------

function BuildStep() {
  const artDirection = useCanvas((s) => s.artDirection?.artDirection);
  const close = useCanvas((s) => s.closeArtDirection);
  const [building, setBuilding] = useState(false);
  if (!artDirection?.chosen) {
    return <EmptyState title="No mock is chosen yet" hint="Choose one on the Mocks step." />;
  }
  const chosen = artDirection.chosen;
  const direction = artDirection.directions.find((d) => d.id === chosen.direction);
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
          <Button variant="outline" size="sm" onClick={() => setBuilding(true)}>
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
      {building ? <BuildDialog onClose={() => setBuilding(false)} /> : null}
    </StepFrame>
  );
}

/** The main area while the art direction is open: the step the rail has selected. */
export function ArtDirectionView() {
  const state = useCanvas((s) => s.artDirection);
  const step = useArtDirectionStep();
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
