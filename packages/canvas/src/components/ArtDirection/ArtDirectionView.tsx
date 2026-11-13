import {
  ART_DIRECTION_LIMITS,
  type ArtDirectionGenerateResult,
  type ArtDirectionSummary,
  describeArtDirectionFailures,
  formatCredits,
} from "@velloo/protocol";
import {
  type ArtDirectionBrief,
  type ArtDirectionDirection,
  type ArtDirectionImage,
  type ArtDirectionPage,
  type ArtDirectionStage,
  activeDirections,
  currentBoard,
} from "@velloo/schema";
import {
  Check,
  CircleAlert,
  MessageSquare,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
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
import { chosenWords, isBoard } from "./chosen.ts";
import { HexText } from "./HexText.tsx";
import { ModelPicker, useModel, useTakesPrompt } from "./ModelPicker.tsx";
import { PagePicker } from "./PagePicker.tsx";
import {
  designFromImages,
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
  const begin = useCanvas((s) => s.beginArtDirection);
  const existing = useCanvas((s) => s.artDirections);
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
  const text = origin === "existing" ? START_FROM_APP : START_FROM_SCRATCH;
  return (
    <div className="flex-1 overflow-y-auto p-10">
      <div className="mx-auto w-full max-w-2xl flex flex-col gap-8">
        {existing && existing.length > 0 ? <ArtDirectionList items={existing} /> : null}
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            {existing?.length ? null : <ArtDirectionMark className="size-10" />}
            <h1 className="text-2xl font-semibold tracking-tight">
              {existing?.length ? "Start another" : "See it before you build it"}
            </h1>
            <p className="text-sm text-muted-foreground">
              Your agent writes a brief and three directions. You narrow them down while image
              models draw a mood board for each, then full-page mocks you can revise in words. The
              ones you choose inspire the screens your agent designs, with your components and your
              design's rules.
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
              prompt={text}
              onPick={(start) =>
                begin({ origin, page: origin === "existing" ? page : null }, text, start)
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}

const STAGE_WORDS: Record<ArtDirectionStage, string> = {
  brief: "Writing the brief",
  directions: "Choosing directions",
  boards: "Mood boards",
  mocks: "Mocks",
  screens: "Screens",
};

/** The design's art directions, to pick one up again where it was left. */
function ArtDirectionList({ items }: { items: ArtDirectionSummary[] }) {
  const open = useCanvas((s) => s.openArtDirection);
  return (
    <section className="flex flex-col gap-3" aria-label="Your art directions">
      <div className="flex items-center gap-3">
        <ArtDirectionMark className="size-8" />
        <h1 className="text-xl font-semibold tracking-tight">Your art directions</h1>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((a) => (
          <button
            key={a.id}
            type="button"
            data-art-direction-item={a.id}
            onClick={() =>
              void open(a.id).catch((err) => toastError(err, "Could not open the art direction"))
            }
            className="group flex cursor-pointer overflow-hidden rounded-xl border bg-card text-left transition-colors hover:border-foreground/30"
          >
            <div className="aspect-square w-24 shrink-0 bg-muted">
              {a.cover ? (
                <img src={`/${a.cover}`} alt="" loading="lazy" className="size-full object-cover" />
              ) : (
                <div className="grid size-full place-items-center">
                  <ArtDirectionMark className="size-8 opacity-40" />
                </div>
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-1 p-3">
              <span className="truncate text-sm font-medium">{a.name}</span>
              <span className="text-xs text-muted-foreground">
                {STAGE_WORDS[a.stage]}
                {a.images > 0 ? ` · ${a.images} ${a.images === 1 ? "image" : "images"}` : ""}
              </span>
              {a.updatedAt ? (
                <span className="text-[11px] text-muted-foreground">
                  {new Date(a.updatedAt).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </span>
              ) : null}
            </div>
          </button>
        ))}
      </div>
    </section>
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
              : `Draw ${unboarded.length} mood board${unboarded.length === 1 ? "" : "s"}${model ? ` · ${formatCredits(model.priceMicros * unboarded.length)}` : ""}`}
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

// --- Choosing what inspires the screens --------------------------------------

/** Choose an image (a mock, or a mood board to skip the mocks) for a screen to be designed from. */
function InspirationToggle({ direction, image }: { direction: string; image: string }) {
  const chosen = useCanvas((s) => s.artDirection?.artDirection.chosen ?? []);
  const update = useCanvas((s) => s.updateArtDirection);
  const on = chosen.some((c) => c.image === image);
  return (
    <Button
      size="xs"
      variant={on ? "default" : "outline"}
      aria-pressed={on}
      onClick={() =>
        void update({
          chosen: on ? chosen.filter((c) => c.image !== image) : [...chosen, { direction, image }],
        }).catch((err) => toastError(err, "Could not choose the image"))
      }
    >
      <Check />
      {on ? "Chosen" : "Use as inspiration"}
    </Button>
  );
}

/** Open the dialog that hands every chosen image to the agent. */
function DesignButton({
  onClick,
  variant = "default",
}: {
  onClick: () => void;
  variant?: "default" | "outline";
}) {
  const artDirection = useCanvas((s) => s.artDirection?.artDirection);
  const n = artDirection?.chosen.length ?? 0;
  return (
    <Button size="sm" variant={variant} disabled={n === 0} onClick={onClick}>
      <WandSparkles />
      {artDirection && n > 0
        ? `Design screens from ${chosenWords(artDirection)}`
        : "Choose images to design from"}
    </Button>
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

/**
 * One image at full size; the arrow keys step through the others it was
 * opened among (every mood board, or every mock, on the step).
 */
function Lightbox({
  images,
  index,
  onIndex,
}: {
  images: ArtDirectionImage[];
  index: number | null;
  onIndex: (index: number | null) => void;
}) {
  const image = index === null ? undefined : images[index];
  useEffect(() => {
    if (index === null) return;
    const step = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") onIndex(Math.min(images.length - 1, index + 1));
      if (e.key === "ArrowLeft") onIndex(Math.max(0, index - 1));
    };
    window.addEventListener("keydown", step);
    return () => window.removeEventListener("keydown", step);
  }, [index, images.length, onIndex]);
  return (
    <Dialog open={image !== undefined} onOpenChange={(o) => (o ? null : onIndex(null))}>
      <DialogContent className="sm:max-w-5xl max-h-[92vh] overflow-y-auto p-2">
        <DialogHeader className="sr-only">
          <DialogTitle>Full size</DialogTitle>
          <DialogDescription>
            The image at full size. The left and right arrow keys show the others.
          </DialogDescription>
        </DialogHeader>
        {image ? <img src={src(image)} alt="" className="w-full rounded" /> : null}
        {images.length > 1 && index !== null ? (
          <p className="pb-1 text-center text-xs text-muted-foreground tabular-nums">
            {index + 1} of {images.length} · ← → for the others
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** The images a step opens at full size, and which one is open. */
function useLightbox(images: ArtDirectionImage[]) {
  const [index, setIndex] = useState<number | null>(null);
  return {
    open: (image: ArtDirectionImage) => setIndex(images.findIndex((i) => i.path === image.path)),
    view: <Lightbox images={images} index={index} onIndex={setIndex} />,
  };
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
            disabled={busy}
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
        {board ? <InspirationToggle direction={direction.id} image={board.path} /> : null}
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
  const count = useCanvas((s) => s.artDirection?.artDirection.mockCount ?? 2);
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
  const fits = useTakesPrompt("mock", model);
  if (!artDirection) return null;
  const picked = activeDirections(artDirection).filter((d) => d.picked);
  const n = picked.length * artDirection.mockCount;
  if (!fits && model) {
    return (
      <Button size="sm" disabled title="Shorten the brief's copy, or pick another model.">
        The copy is too long for {model.label}
      </Button>
    );
  }
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
        : `${label ?? "Draw"} ${n} mock${n === 1 ? "" : "s"}${model ? ` · ${formatCredits(model.priceMicros * n)}` : ""}`}
    </Button>
  );
}

function BoardsStep() {
  const artDirection = useCanvas((s) => s.artDirection?.artDirection);
  const update = useCanvas((s) => s.updateArtDirection);
  const [designing, setDesigning] = useState(false);
  const active = artDirection ? activeDirections(artDirection) : [];
  const lightbox = useLightbox(
    active.map((d) => currentBoard(d)).filter((b): b is ArtDirectionImage => Boolean(b)),
  );
  if (!artDirection) return null;
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
      ask="Regenerate any you'd like another take on, and untick the ones that shouldn't go on. Each picked direction gets mocks drawn from its mood board, or skip the mocks: use a mood board as inspiration and your agent designs the page in its look."
      footer={
        <>
          <span className="text-sm text-muted-foreground">
            {active.filter((d) => d.picked).length} of {active.length} go on to mocks
          </span>
          {artDirection.chosen.length > 0 ? (
            <DesignButton variant="outline" onClick={() => setDesigning(true)} />
          ) : null}
          <div className="flex-1" />
          <MockCountPicker />
          <ModelPicker intent="mock" />
          <DrawMocksButton />
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        {active.map((d) => (
          <BoardCard key={d.id} direction={d} onOpen={lightbox.open} />
        ))}
      </div>
      {lightbox.view}
      {designing && artDirection.chosen.length > 0 ? (
        <DesignDialog onClose={() => setDesigning(false)} />
      ) : null}
    </StepFrame>
  );
}

// --- Mocks -------------------------------------------------------------------

/**
 * Redraw a mock with a change in words ("more spacious"): the mock goes to the
 * image model as the picture to revise, and the new versions land beside it.
 */
function ReviseDialog({
  direction,
  mock,
  onClose,
}: {
  direction: ArtDirectionDirection;
  mock: ArtDirectionImage;
  onClose: () => void;
}) {
  const draw = useDraw();
  const model = useModel("mock");
  const perDirection = useCanvas((s) => s.artDirection?.artDirection.mockCount ?? 2);
  const [instruction, setInstruction] = useState("");
  const [count, setCount] = useState(Math.min(perDirection, 4));
  const ready = instruction.trim().length > 0 && Boolean(model);
  const go = () => {
    if (!ready) return;
    draw(
      {
        kind: "mock",
        directions: [direction.id],
        count,
        revise: { mock: mock.path, instruction: instruction.trim() },
      },
      "mocks",
    );
    onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Revise this mock</DialogTitle>
          <DialogDescription>
            Say what to change. The image model redraws the mock with it, keeps the rest, and the
            new versions land beside it.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-4">
          <img
            src={src(mock)}
            alt=""
            className="aspect-[9/16] w-24 shrink-0 rounded border object-cover object-top"
          />
          <Field className="flex-1">
            <FieldLabel htmlFor="art-direction-revise">The change</FieldLabel>
            <Textarea
              id="art-direction-revise"
              rows={5}
              autoFocus
              maxLength={ART_DIRECTION_LIMITS.instruction}
              placeholder="Make it more spacious, with a bigger hero and fewer cards"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) go();
              }}
            />
          </Field>
        </div>
        <DialogFooter className="flex-wrap items-center gap-2 sm:justify-start">
          <NativeSelect
            size="sm"
            aria-label="New versions"
            value={String(count)}
            onChange={(e) => setCount(Number(e.target.value))}
          >
            {[1, 2, 3, 4].map((n) => (
              <NativeSelectOption key={n} value={String(n)}>
                {n} {n === 1 ? "version" : "versions"}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <ModelPicker intent="mock" />
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={!ready} onClick={go}>
            <Sparkles />
            Redraw{model ? ` · ${formatCredits(model.priceMicros * count)}` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MockRow({
  direction,
  onOpen,
}: {
  direction: ArtDirectionDirection;
  onOpen: (i: ArtDirectionImage) => void;
}) {
  const chosen = useCanvas((s) => s.artDirection?.artDirection.chosen);
  const [revising, setRevising] = useState<ArtDirectionImage | null>(null);
  const id = useCanvas((s) => s.artDirectionId);
  const remove = (path: string) =>
    void artDirectionApi
      .removeImage(id ?? "", path)
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
          const isChosen = chosen?.some((c) => c.image === m.path) ?? false;
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
              {m.instruction ? (
                <p className="line-clamp-2 text-xs text-muted-foreground" title={m.instruction}>
                  Revised: {m.instruction}
                </p>
              ) : null}
              <div className="flex items-center gap-1">
                <InspirationToggle direction={direction.id} image={m.path} />
                <div className="flex-1" />
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Revise this mock"
                  title="Revise this mock"
                  disabled={busy}
                  onClick={() => setRevising(m)}
                >
                  <Pencil />
                </Button>
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
      {revising ? (
        <ReviseDialog direction={direction} mock={revising} onClose={() => setRevising(null)} />
      ) : null}
    </section>
  );
}

function MocksStep() {
  const artDirection = useCanvas((s) => s.artDirection?.artDirection);
  const [designing, setDesigning] = useState(false);
  const picked = artDirection ? activeDirections(artDirection).filter((d) => d.picked) : [];
  const lightbox = useLightbox(picked.flatMap((d) => d.mocks));
  if (!artDirection) return null;
  const anyMocks = picked.some((d) => d.mocks.length > 0);
  const chosen = artDirection.chosen;
  return (
    <StepFrame
      title="Mocks"
      ask="Open any mock at full size, revise one in words, draw more of a direction you like, and choose the ones to use as inspiration. Your agent designs a screen from each in its look, with your components and your design's rules: a starting point, not a copy."
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
          <DesignButton onClick={() => setDesigning(true)} />
        </>
      }
    >
      {picked.length === 0 ? (
        <EmptyState
          title="No direction is picked"
          hint="Go back to the mood boards and tick one."
        />
      ) : (
        picked.map((d) => <MockRow key={d.id} direction={d} onOpen={lightbox.open} />)
      )}
      {lightbox.view}
      {designing && chosen.length > 0 ? <DesignDialog onClose={() => setDesigning(false)} /> : null}
    </StepFrame>
  );
}

/**
 * Hand the chosen images to the agent, after asking the one thing only the
 * person can decide (whether the screens may spend credits drawing the
 * photographs and illustrations the images show), whether each mock goes with
 * its mood board, and anything they want to add. The canvas then shows the
 * board the screens land on.
 */
function DesignDialog({ onClose }: { onClose: () => void }) {
  const build = useCanvas((s) => s.buildArtDirection);
  const artDirection = useCanvas((s) => s.artDirection?.artDirection);
  const chosen = artDirection?.chosen ?? [];
  const [images, setImages] = useState<boolean>(artDirection?.generateImages ?? true);
  const [withBoards, setWithBoards] = useState(artDirection?.buildWithBoards ?? true);
  const [instructions, setInstructions] = useState(artDirection?.buildNotes ?? "");
  const [busy, setBusy] = useState(false);
  if (!artDirection) return null;
  const words = chosenWords(artDirection);
  // A mock drawn from a mood board can go with it; a chosen mood board is already one.
  const mocksWithBoards = chosen.filter((c) => {
    if (isBoard(artDirection, c)) return false;
    return artDirection.directions.find((d) => d.id === c.direction)?.boards.length;
  }).length;
  const go = () => {
    setBusy(true);
    void build(
      { chosen, generateImages: images, withBoards, instructions },
      designFromImages(words, instructions),
    )
      .then(onClose)
      .catch((err) => toastError(err, "Could not hand the images to the agent"))
      .finally(() => setBusy(false));
  };
  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Design screens from {words}</DialogTitle>
          <DialogDescription>
            Your agent takes {chosen.length === 1 ? "its" : "each one's"} look as inspiration and
            designs a screen from your components and your design's rules, on a board of its own you
            can watch.
          </DialogDescription>
        </DialogHeader>
        <ChoiceCards
          label="Images"
          className="flex flex-col gap-2"
          value={images ? "yes" : "no"}
          options={[
            {
              value: "yes",
              title: "Generate the pictures they show",
              body: "Photographs and illustrations drawn to match, paid from your credits (about $0.04 each).",
            },
            {
              value: "no",
              title: "No generated pictures",
              body: "Your agent draws simple art itself, or leaves clear placeholders for your own.",
            },
          ]}
          onChange={(v) => setImages(v === "yes")}
        />
        {mocksWithBoards > 0 ? (
          <Field orientation="horizontal">
            <Checkbox
              id="art-direction-with-boards"
              checked={withBoards}
              onCheckedChange={(v) => setWithBoards(v === true)}
            />
            <FieldLabel htmlFor="art-direction-with-boards" className="font-normal">
              Send {mocksWithBoards === 1 ? "the mock" : "each mock"} with its mood board too
            </FieldLabel>
          </Field>
        ) : null}
        <Field>
          <FieldLabel htmlFor="art-direction-build-notes">Instructions (optional)</FieldLabel>
          <Textarea
            id="art-direction-build-notes"
            rows={3}
            maxLength={2000}
            placeholder="Keep our current navigation. Use the pricing from the live page."
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
          />
        </Field>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={go} disabled={busy}>
            {busy ? <Spinner /> : <WandSparkles />}
            Start designing
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Screens -----------------------------------------------------------------

function ScreensStep() {
  const artDirection = useCanvas((s) => s.artDirection?.artDirection);
  const boards = useCanvas((s) => s.boards);
  const showBuild = useCanvas((s) => s.showArtDirectionBuild);
  const [designing, setDesigning] = useState(false);
  const chosen = artDirection?.chosen ?? [];
  const images = chosen
    .map((c) => {
      const d = artDirection?.directions.find((x) => x.id === c.direction);
      return d?.mocks.find((m) => m.path === c.image) ?? d?.boards.find((b) => b.path === c.image);
    })
    .filter((m): m is ArtDirectionImage => Boolean(m));
  const boardPaths = new Set(
    artDirection?.directions.flatMap((d) => d.boards.map((b) => b.path)) ?? [],
  );
  const lightbox = useLightbox(images);
  if (!artDirection || chosen.length === 0) {
    return (
      <EmptyState
        title="Nothing is chosen yet"
        hint="Use a mock, or a mood board, as inspiration on its step."
      />
    );
  }
  const board = artDirection.buildBoard ? boards[artDirection.buildBoard] : undefined;
  return (
    <StepFrame
      title="Screens"
      ask="Your agent designs a screen inspired by each image you chose, from your app's components and your design's rules. Keep talking to it in the Agent tab to take the screens further."
      footer={
        <>
          {board ? (
            <Button size="sm" variant="outline" onClick={() => void showBuild()}>
              Open the board “{board.name}”
            </Button>
          ) : null}
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={() => setDesigning(true)}>
            <WandSparkles />
            Design again
          </Button>
        </>
      }
    >
      <div className="grid gap-4 grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
        {images.map((m) => (
          <ImageTile
            key={m.path}
            image={m}
            busy={false}
            tall={!boardPaths.has(m.path)}
            onOpen={() => lightbox.open(m)}
          />
        ))}
      </div>
      {artDirection.buildNotes ? (
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Your instructions: </span>
          {artDirection.buildNotes}
        </p>
      ) : null}
      {lightbox.view}
      {designing ? <DesignDialog onClose={() => setDesigning(false)} /> : null}
    </StepFrame>
  );
}

/** The main area while the art direction is open: the step the rail has selected. */
export function ArtDirectionView() {
  const id = useCanvas((s) => s.artDirectionId);
  const state = useCanvas((s) => s.artDirection);
  const step = useArtDirectionStep();
  if (!id) return <Start />;
  if (!state || state.id !== id) {
    return (
      <div className="flex-1 grid place-items-center">
        <Loading size={36} />
      </div>
    );
  }
  switch (step) {
    case "brief":
      return <BriefStep />;
    case "directions":
      return <DirectionsStep />;
    case "boards":
      return <BoardsStep />;
    case "mocks":
      return <MocksStep />;
    case "screens":
      return <ScreensStep />;
  }
}
