import {
  describeSketchbookFailures,
  type IntentPrice,
  REVISION_NUDGES,
  SKETCHBOOK_LIMITS,
  type SketchbookGenerateResult,
} from "@velloo/protocol";
import {
  activeDirections,
  designsScreens,
  findSketchbookImage,
  imagesOf,
  latestOf,
  PAGE_IMAGE_KINDS,
  type SketchbookBrief,
  type SketchbookDirection,
  type SketchbookImage,
} from "@velloo/schema";
import {
  Check,
  ChevronDown,
  CircleAlert,
  Lock,
  MessageSquare,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Shuffle,
  Sparkles,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { sketchbook as sketchbookApi } from "../../api/sketchbook.ts";
import { useCanvas } from "../../store.ts";
import { pushToast, toastError } from "../../toast.ts";
import { Credits } from "../Credits.tsx";
import { EmptyState } from "../EmptyState.tsx";
import { useLightbox } from "../ImageLightbox.tsx";
import { Loading } from "../Loading.tsx";
import { PlaceComments } from "../PlaceComments.tsx";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.tsx";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "../ui/field.tsx";
import { Input } from "../ui/input.tsx";
import { NativeSelect, NativeSelectOption } from "../ui/native-select.tsx";
import { Spinner } from "../ui/spinner.tsx";
import { Textarea } from "../ui/textarea.tsx";
import { BriefView } from "./BriefView.tsx";
import { ChoiceCards } from "./ChoiceCards.tsx";
import { chosenWords, isBoard } from "./chosen.ts";
import { HexText } from "./HexText.tsx";
import { ModelPicker, useKindLabel, useKinds, useModel, useTakesPrompt } from "./ModelPicker.tsx";
import { ProposalPanel } from "./ProposalPanel.tsx";
import { designFromImages, proposeMore, proposeTokens, reviseDirection } from "./prompts.ts";
import { DirectionReferences, ReferencesPanel } from "./References.tsx";
import { RemixButton } from "./Remix.tsx";
import { SketchbookHome } from "./SketchbookHome.tsx";
import { useSketchbookStep } from "./SketchbookRail.tsx";
import { StartPage } from "./StartPage.tsx";

const src = (image: SketchbookImage) => `/${image.path}`;

/** The shape each kind is drawn at, for its tile before and after it lands. */
const ASPECT: Record<string, string> = {
  mock: "aspect-[9/16]",
  mobile: "aspect-[9/16]",
  typeposter: "aspect-[2/3]",
  icons: "aspect-square",
};
const aspectOf = (kind: string) => ASPECT[kind] ?? "aspect-[3/2]";

/** The kinds that are inspiration only: shown with the mood board, sent with the screens. */
const isInspiration = (kind: string) => !designsScreens(kind);

/** Say what a draw produced, cost included: every image is paid for. */
function reportDraw(result: SketchbookGenerateResult, noun: string) {
  const made = result.made.length;
  if (result.failed.length > 0) {
    const titles = new Map(
      useCanvas.getState().sketchbook?.sketchbook.directions.map((d) => [d.id, d.title]) ?? [],
    );
    toastError(
      describeSketchbookFailures(result.failed, (id) => titles.get(id) ?? id),
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
  const generate = useCanvas((s) => s.generateSketchbook);
  return (body: Parameters<typeof generate>[0], noun: string) =>
    void generate(body)
      .then((r) => reportDraw(r, noun))
      .catch((err) => toastError(err, `Could not draw the ${noun}`));
}

function useBusy(direction: string, kind: string): boolean {
  const pending = useCanvas((s) =>
    s.sketchbook?.pending.some((p) => p.direction === direction && p.kind === kind),
  );
  const local = useCanvas((s) => s.sketchbookBusy.includes(`${kind}:${direction}`));
  return Boolean(pending || local);
}

/** The kinds being drawn for a direction right now, by this canvas or anyone. */
function useBusyKinds(direction: string): string[] {
  const pending = useCanvas((s) => s.sketchbook?.pending);
  const local = useCanvas((s) => s.sketchbookBusy);
  return [
    ...new Set([
      ...(pending ?? []).filter((p) => p.direction === direction).map((p) => p.kind),
      ...local.filter((b) => b.endsWith(`:${direction}`)).map((b) => b.split(":")[0] as string),
    ]),
  ];
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

// --- Brief -----------------------------------------------------------------

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

function BriefStep() {
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

// --- Directions --------------------------------------------------------------

function DirectionEditor({
  direction,
  onClose,
}: {
  direction: SketchbookDirection;
  onClose: () => void;
}) {
  const update = useCanvas((s) => s.updateSketchbook);
  const ask = useCanvas((s) => s.askSketchbookAgent);
  const [title, setTitle] = useState(direction.title);
  const [description, setDescription] = useState(direction.description);
  const [layout, setLayout] = useState(direction.layout);
  const [request, setRequest] = useState("");
  const look = useCanvas((s) => s.sketchbook?.sketchbook.subject === "look");
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
          <Field className={look ? "hidden" : undefined}>
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

/** Which two directions a remix came from, and what it takes. */
function RemixOf({ direction }: { direction: SketchbookDirection }) {
  const directions = useCanvas((s) => s.sketchbook?.sketchbook.directions);
  const titles = direction.remixOf.map((id) => directions?.find((d) => d.id === id)?.title ?? id);
  if (direction.remixOf.length === 0) return null;
  return (
    <CardDescription className="flex items-start gap-1.5" data-remix-of>
      <Shuffle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        A remix of {titles.join(" and ")}
        {direction.take ? `: ${direction.take}` : ""}
      </span>
    </CardDescription>
  );
}

function DirectionCard({ direction }: { direction: SketchbookDirection }) {
  const update = useCanvas((s) => s.updateSketchbook);
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
        <RemixOf direction={direction} />
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
        <DirectionReferences direction={direction} />
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
    </div>
  );
}

function DirectionsStep() {
  const sketchbook = useCanvas((s) => s.sketchbook?.sketchbook);
  const update = useCanvas((s) => s.updateSketchbook);
  const setStep = useCanvas((s) => s.setSketchbookStep);
  const draw = useDraw();
  const model = useModel("moodboard");
  if (!sketchbook) return null;
  const active = activeDirections(sketchbook);
  const unboarded = active.filter((d) => !latestOf(d, "moodboard"));
  return (
    <StepFrame
      title="Directions"
      ask="Drop the ones that aren't you, edit any of them, or ask for more. A mood board is drawn for each one still in the running."
      footer={
        <>
          <span className="text-sm text-muted-foreground">
            {active.length} of {sketchbook.directions.length} continue
          </span>
          <RemixButton />
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="sm"
            className={sketchbook.subject === "look" ? "hidden" : undefined}
            disabled={active.length === 0}
            onClick={() =>
              void update({ stage: "mocks" })
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
              draw({ kind: "moodboard", directions: unboarded.map((d) => d.id) }, "mood boards");
              setStep("inspiration");
            }}
          >
            <Palette />
            {unboarded.length === 0 ? (
              "Every direction has a mood board"
            ) : (
              <>
                Draw {unboarded.length} mood board{unboarded.length === 1 ? "" : "s"}
                {model ? (
                  <>
                    {" · "}
                    <Credits micros={model.priceMicros * unboarded.length} />
                  </>
                ) : null}
              </>
            )}
          </Button>
        </>
      }
    >
      {sketchbook.directions.length === 0 ? (
        <EmptyState
          title="Your agent is proposing directions"
          hint="Three looks that differ from each other and from what you have. They show here as they land."
          icon={Sparkles}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sketchbook.directions.map((d) => (
            <DirectionCard key={d.id} direction={d} />
          ))}
        </div>
      )}
      <ProposeMore />
      <ReferencesPanel />
    </StepFrame>
  );
}

// --- Choosing what inspires the screens --------------------------------------

/** Choose an image (a mock, or a mood board to skip the mocks) for a screen to be designed from. */
function InspirationToggle({ direction, image }: { direction: string; image: string }) {
  const chosen = useCanvas((s) => s.sketchbook?.sketchbook.chosen ?? []);
  const update = useCanvas((s) => s.updateSketchbook);
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
  const sketchbook = useCanvas((s) => s.sketchbook?.sketchbook);
  const n = sketchbook?.chosen.length ?? 0;
  return (
    <Button size="sm" variant={variant} disabled={n === 0} onClick={onClick}>
      <WandSparkles />
      {sketchbook && n > 0
        ? `Design screens from ${chosenWords(sketchbook)}`
        : "Choose images to design from"}
    </Button>
  );
}

// --- Mood boards -------------------------------------------------------------

function ImageTile({
  image,
  busy,
  kind = image?.kind ?? "moodboard",
  onOpen,
  children,
}: {
  image: SketchbookImage | undefined;
  busy: boolean;
  /** What is drawn there, for its shape while it is still being drawn. */
  kind?: string;
  onOpen?: () => void;
  children?: ReactNode;
}) {
  const tall = kind === "mock" || kind === "mobile";
  const sketchbookId = useCanvas((s) => s.sketchbookId);
  const file = useCanvas((s) => s.sketchbook?.sketchbook);
  const direction = image && file ? findSketchbookImage(file, image.path)?.direction.id : undefined;
  return (
    <div className={`relative overflow-hidden rounded-lg border bg-muted ${aspectOf(kind)}`}>
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
      {image && sketchbookId ? (
        <PlaceComments
          place={{
            kind: "sketchbook",
            sketchbook: sketchbookId,
            ...(direction !== undefined && { direction }),
            image: image.path,
          }}
          label="this image"
          className="absolute right-2 top-2"
        />
      ) : null}
    </div>
  );
}

/**
 * Keep a direction as a Look: its theme and its images. Proposed tokens go
 * with it, and it opens on the language stage as a draft to refine. Without
 * them, an agent on the sketchbook is asked to set the Look's tokens, rules
 * and imagery from the images; with no agent, the Look opens in the Looks
 * rail as it was made.
 */
function MakeLookButton({
  direction,
  variant = "ghost",
}: {
  direction: SketchbookDirection;
  variant?: "ghost" | "default";
}) {
  const id = useCanvas((s) => s.sketchbookId);
  const makeLook = useCanvas((s) => s.makeLook);
  const [busy, setBusy] = useState(false);
  if (!id || direction.images.length === 0) return null;
  const go = async () => {
    setBusy(true);
    try {
      const { name, draft } = await makeLook(id, direction);
      pushToast({
        kind: "info",
        message: draft
          ? `"${name}" is a draft Look with the proposed tokens. Refine it, then Done keeps it.`
          : `"${name}" is a Look now. Boards can use it from the Looks rail.`,
      });
    } catch (err) {
      toastError(err, "Could not make the look");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant={variant} size="sm" disabled={busy} onClick={() => void go()}>
      {busy ? <Spinner /> : <Palette />}
      Make this a Look
    </Button>
  );
}

/** One kind in the Draw menu: its label, its price on the model it would run on, its lock. */
function DrawMenuItem({ kind, onDraw }: { kind: IntentPrice; onDraw: () => void }) {
  const model = useModel(kind.intent);
  const label = useKindLabel(kind.intent);
  const locked = Boolean(kind.locked || model?.locked);
  const price = model?.priceMicros ?? kind.priceMicros;
  return (
    <DropdownMenuItem disabled={locked} onSelect={onDraw} title={kind.summary}>
      <span className="flex-1">{label}</span>
      {locked ? (
        <Lock aria-label="Add credits to unlock" />
      ) : price > 0 ? (
        <Credits micros={price} className="text-xs text-muted-foreground" />
      ) : null}
    </DropdownMenuItem>
  );
}

/**
 * Draw one image of any kind the cloud lists for a direction: a palette, a
 * type poster, a mobile mock… Each is drawn from the direction's mood board
 * when it has one.
 */
function DrawMenu({ direction, disabled }: { direction: SketchbookDirection; disabled?: boolean }) {
  const kinds = useKinds();
  const models = useCanvas((s) => s.sketchbookModels);
  const draw = useDraw();
  if (kinds.length === 0 || !models) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" disabled={disabled}>
          <Plus />
          Draw
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel>Draw “{direction.title}” as</DropdownMenuLabel>
        {kinds.map((k) => (
          <DrawMenuItem
            key={k.intent}
            kind={k}
            onDraw={() =>
              draw(
                { kind: k.intent, directions: [direction.id], count: 1 },
                (k.label ?? k.intent).toLowerCase(),
              )
            }
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A direction's images of one kind, under the kind's name, with a tile for one being drawn. */
function KindGroup({
  direction,
  kind,
  onOpen,
  actions,
}: {
  direction: SketchbookDirection;
  kind: string;
  onOpen: (i: SketchbookImage) => void;
  actions?: (image: SketchbookImage) => ReactNode;
}) {
  const label = useKindLabel(kind);
  const busy = useBusy(direction.id, kind);
  const images = imagesOf(direction, kind);
  const tall = kind === "mock" || kind === "mobile" || kind === "typeposter";
  return (
    <section data-kind={kind} className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-muted-foreground">
        {label}
        {images.length > 1 ? ` · ${images.length}` : ""}
      </h3>
      <div
        className={`grid gap-3 ${tall ? "grid-cols-2 md:grid-cols-3 xl:grid-cols-4" : "grid-cols-2 md:grid-cols-3"}`}
      >
        {images.map((image) => (
          <div key={image.path} className="flex flex-col gap-1.5">
            <ImageTile image={image} busy={false} onOpen={() => onOpen(image)} />
            {actions?.(image)}
          </div>
        ))}
        {busy ? <ImageTile image={undefined} busy kind={kind} /> : null}
      </div>
    </section>
  );
}

/** The kinds a direction has drawn (or is drawing) that `keep` lets through, in the cloud's order. */
function useKindsShown(direction: SketchbookDirection, keep: (kind: string) => boolean): string[] {
  const listed = useKinds().map((k) => k.intent);
  const busy = useBusyKinds(direction.id);
  const present = [...new Set([...direction.images.map((i) => i.kind), ...busy])].filter(keep);
  const at = (k: string) => (listed.includes(k) ? listed.indexOf(k) : listed.length);
  return present.sort((a, b) => at(a) - at(b));
}

function BoardCard({
  direction,
  onOpen,
  look = false,
}: {
  direction: SketchbookDirection;
  onOpen: (i: SketchbookImage) => void;
  /** In a Look sketchbook: no mocks to continue to, no screens to inspire. */
  look?: boolean;
}) {
  const update = useCanvas((s) => s.updateSketchbook);
  const draw = useDraw();
  const busy = useBusy(direction.id, "moodboard");
  const failure = useCanvas((s) => s.sketchbookFailures[direction.id]);
  const board = latestOf(direction, "moodboard");
  const boards = imagesOf(direction, "moodboard");
  const others = useKindsShown(direction, (k) => k !== "moodboard" && isInspiration(k));
  return (
    <Card data-direction={direction.id} className={direction.picked ? undefined : "opacity-60"}>
      <CardHeader>
        <CardTitle>{direction.title}</CardTitle>
        {boards.length > 1 ? <CardDescription>Version {boards.length}</CardDescription> : null}
        <RemixOf direction={direction} />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
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
        {board ? (
          <div className="-mt-2 flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <RevisionNote image={board} />
            </div>
            <ReviseMenu direction={direction} image={board} disabled={busy} />
          </div>
        ) : null}
        {board && failure && !busy ? <Failure message={failure} /> : null}
        {others.map((kind) => (
          <KindGroup
            key={kind}
            direction={direction}
            kind={kind}
            onOpen={onOpen}
            actions={(image) => (
              <div className="flex items-center gap-1">
                <div className="min-w-0 flex-1">
                  <RevisionNote image={image} />
                </div>
                <ReviseMenu direction={direction} image={image} />
              </div>
            )}
          />
        ))}
      </CardContent>
      <CardFooter className="flex-wrap gap-3">
        <div className={look ? "hidden" : "flex items-center gap-2 text-sm"}>
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
        {board && !look ? <InspirationToggle direction={direction.id} image={board.path} /> : null}
        {look ? null : <MakeLookButton direction={direction} />}
        <DrawMenu direction={direction} />
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
  const count = useCanvas((s) => s.sketchbook?.sketchbook.mockCount ?? 2);
  const update = useCanvas((s) => s.updateSketchbook);
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
  const sketchbook = useCanvas((s) => s.sketchbook?.sketchbook);
  const setStep = useCanvas((s) => s.setSketchbookStep);
  const draw = useDraw();
  const model = useModel("mock");
  const fits = useTakesPrompt("mock", model);
  if (!sketchbook) return null;
  const picked = activeDirections(sketchbook).filter((d) => d.picked);
  const n = picked.length * sketchbook.mockCount;
  if (!fits && model) {
    return (
      <Button size="sm" disabled title="Shorten the brief's copy, or pick another model.">
        The copy is too long for {model.label}
      </Button>
    );
  }
  // Mocks are drawn from each direction's mood board: one without it waits.
  const unboarded: typeof picked = [];
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
      {n === 0 ? (
        "Pick a direction to continue"
      ) : (
        <>
          {label ?? "Draw"} {n} mock{n === 1 ? "" : "s"}
          {model ? (
            <>
              {" · "}
              <Credits micros={model.priceMicros * n} />
            </>
          ) : null}
        </>
      )}
    </Button>
  );
}

/** The system kinds a Look sketchbook draws per direction, beside its mood board. */
const LOOK_KINDS = ["palette", "typeposter"] as const;

/**
 * A Look sketchbook's boards: each direction's mood board, palette and type
 * poster, drawn here, before the agent reads tokens off them.
 */
function LookBoardsStep() {
  const sketchbook = useCanvas((s) => s.sketchbook?.sketchbook);
  const update = useCanvas((s) => s.updateSketchbook);
  const ask = useCanvas((s) => s.askSketchbookAgent);
  const setStep = useCanvas((s) => s.setSketchbookStep);
  const offered = useKinds().map((k) => k.intent);
  const draw = useDraw();
  const active = sketchbook ? activeDirections(sketchbook) : [];
  const lightbox = useLightbox(
    active.flatMap((d) =>
      [...new Set(d.images.map((i) => i.kind))]
        .map((k) => latestOf(d, k))
        .filter((i): i is SketchbookImage => Boolean(i)),
    ),
  );
  if (!sketchbook) return null;
  const missing = LOOK_KINDS.filter((k) => offered.includes(k)).flatMap((kind) =>
    active.filter((d) => !latestOf(d, kind)).map((d) => ({ kind, direction: d.id })),
  );
  const drawn = active.filter((d) => d.images.length > 0);
  return (
    <StepFrame
      title="Palettes and type"
      ask="Each direction drawn as a mood board, a palette in use and a type poster. Regenerate any you'd like another take on; then your agent reads tokens and a font pairing off them."
      footer={
        <>
          {missing.length > 0 ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                for (const kind of LOOK_KINDS) {
                  const directions = missing.filter((m) => m.kind === kind).map((m) => m.direction);
                  if (directions.length > 0) {
                    draw({ kind, directions }, kind === "palette" ? "palettes" : "type posters");
                  }
                }
              }}
            >
              <Palette />
              Draw {missing.length} palette and type {missing.length === 1 ? "image" : "images"}
            </Button>
          ) : null}
          <div className="flex-1" />
          <Button
            size="sm"
            disabled={drawn.length === 0}
            onClick={() =>
              void update({ stage: "directions" })
                .then(() => {
                  setStep("directions");
                  return ask(proposeTokens(drawn.map((d) => d.title)));
                })
                .catch((err) => toastError(err, "Could not ask the agent"))
            }
          >
            <Sparkles />
            Ask your agent for tokens
          </Button>
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        {active.map((d) => (
          <BoardCard key={d.id} direction={d} onOpen={lightbox.open} look />
        ))}
      </div>
      {lightbox.view}
    </StepFrame>
  );
}

/**
 * A Look sketchbook's last step: each direction's proposed tokens on the
 * design's own components, beside the images they were read from, with the
 * contrast scored. The one the person keeps becomes a draft Look.
 */
function TokensStep() {
  const id = useCanvas((s) => s.sketchbookId);
  const sketchbook = useCanvas((s) => s.sketchbook?.sketchbook);
  const ask = useCanvas((s) => s.askSketchbookAgent);
  const active = sketchbook ? activeDirections(sketchbook) : [];
  const lightbox = useLightbox(
    active.flatMap((d) =>
      ["palette", "typeposter", "moodboard"]
        .map((k) => latestOf(d, k))
        .filter((i): i is SketchbookImage => Boolean(i)),
    ),
  );
  if (!sketchbook || !id) return null;
  const unproposed = active.filter((d) => !d.proposal);
  const version = sketchbook.updatedAt ?? "";
  return (
    <StepFrame
      title="Tokens"
      ask="Each direction's proposed colours, corners and fonts on your own components, beside the images they were read from. Make the one you want a Look: it opens on the language stage, where you can still refine it."
      footer={
        <>
          <span className="text-sm text-muted-foreground">
            {active.length - unproposed.length} of {active.length} proposed
          </span>
          <div className="flex-1" />
          {unproposed.length > 0 ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void ask(proposeTokens(unproposed.map((d) => d.title))).catch((err) =>
                  toastError(err, "Could not ask the agent"),
                )
              }
            >
              <Sparkles />
              Ask your agent for the rest
            </Button>
          ) : null}
        </>
      }
    >
      {active.map((d) => (
        <Card key={d.id} data-direction={d.id}>
          <CardHeader>
            <CardTitle>{d.title}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-[240px_minmax(0,1fr)]">
            <div className="flex flex-col gap-3">
              {["palette", "typeposter", "moodboard"].map((kind) => {
                const image = latestOf(d, kind);
                return image ? (
                  <ImageTile
                    key={kind}
                    image={image}
                    busy={false}
                    onOpen={() => lightbox.open(image)}
                  />
                ) : null;
              })}
            </div>
            {d.proposal ? (
              <ProposalPanel
                sketchbookId={id}
                direction={d.id}
                proposal={d.proposal}
                version={version}
              />
            ) : (
              <EmptyState
                size="panel"
                icon={Sparkles}
                title="No tokens proposed yet"
                hint="Your agent reads them off this direction's images and writes them here."
              />
            )}
          </CardContent>
          {d.proposal ? (
            <CardFooter>
              <div className="flex-1" />
              <MakeLookButton direction={d} variant="default" />
            </CardFooter>
          ) : null}
        </Card>
      ))}
      {lightbox.view}
    </StepFrame>
  );
}

function BoardsStep() {
  const sketchbook = useCanvas((s) => s.sketchbook?.sketchbook);
  const [designing, setDesigning] = useState(false);
  const active = sketchbook ? activeDirections(sketchbook) : [];
  const lightbox = useLightbox(
    active.flatMap((d) => [
      ...[latestOf(d, "moodboard")].filter((b): b is SketchbookImage => Boolean(b)),
      ...d.images.filter((i) => i.kind !== "moodboard" && isInspiration(i.kind)),
    ]),
  );
  if (!sketchbook) return null;
  if (sketchbook.subject === "look") return <LookBoardsStep />;
  return (
    <StepFrame
      title="Mood boards"
      ask="Regenerate any you'd like another take on, and untick the ones that shouldn't go on. Each picked direction gets mocks drawn from its mood board, or skip the mocks: use a mood board as inspiration and your agent designs the page in its look."
      footer={
        <>
          <span className="text-sm text-muted-foreground">
            {active.filter((d) => d.picked).length} of {active.length} go on to mocks
          </span>
          {sketchbook.chosen.length > 0 ? (
            <DesignButton variant="outline" onClick={() => setDesigning(true)} />
          ) : null}
          <RemixButton />
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
      {designing && sketchbook.chosen.length > 0 ? (
        <DesignDialog onClose={() => setDesigning(false)} />
      ) : null}
    </StepFrame>
  );
}

// --- Mocks -------------------------------------------------------------------

/** How a revision is shown under its image: the nudge's name, or the person's words. */
function revisionLabel(instruction: string): string {
  if (instruction === REVISION_NUDGES.bolder) return "Bolder";
  if (instruction === REVISION_NUDGES.quieter) return "Quieter";
  return instruction;
}

/** What an image of a kind is called in a sentence: "mock", "mood board". */
function useNoun(kind: string): string {
  const label = useKindLabel(kind);
  return kind === "mock" ? "mock" : label.toLowerCase();
}

/**
 * Redraw an image of any kind with a change in words ("more spacious"): it
 * goes to the image model as the picture to revise, and the new versions
 * land beside it.
 */
function ReviseDialog({
  direction,
  image,
  onClose,
}: {
  direction: SketchbookDirection;
  image: SketchbookImage;
  onClose: () => void;
}) {
  const draw = useDraw();
  const kind = image.kind;
  const noun = useNoun(kind);
  const model = useModel(kind);
  const perDirection = useCanvas((s) => s.sketchbook?.sketchbook.mockCount ?? 2);
  const [instruction, setInstruction] = useState("");
  const [count, setCount] = useState(
    PAGE_IMAGE_KINDS.includes(kind) ? Math.min(perDirection, 4) : 1,
  );
  const ready = instruction.trim().length > 0 && Boolean(model);
  const go = () => {
    if (!ready) return;
    draw(
      {
        kind,
        directions: [direction.id],
        count,
        revise: { image: image.path, instruction: instruction.trim() },
      },
      `${noun}s`,
    );
    onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Change this {noun}</DialogTitle>
          <DialogDescription>
            Say what to change. The image model redraws the {noun} with it, keeps the rest, and the
            new versions land beside it.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-4">
          <img
            src={src(image)}
            alt=""
            className={`${aspectOf(kind)} w-24 shrink-0 self-start rounded border object-cover object-top`}
          />
          <Field className="flex-1">
            <FieldLabel htmlFor="sketchbook-revise">The change</FieldLabel>
            <Textarea
              id="sketchbook-revise"
              rows={5}
              autoFocus
              maxLength={SKETCHBOOK_LIMITS.instruction}
              placeholder={
                PAGE_IMAGE_KINDS.includes(kind)
                  ? "Make it more spacious, with a bigger hero and fewer cards"
                  : "Warmer colours, and photographs instead of illustrations"
              }
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
          <ModelPicker intent={kind} />
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={!ready} onClick={go}>
            <Sparkles />
            Redraw
            {model ? (
              <>
                {" · "}
                <Credits micros={model.priceMicros * count} />
              </>
            ) : null}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Nudge an image: bolder, quieter, or a change in words. Each redraws it with
 * the image itself as the reference, one new version beside it.
 */
function ReviseMenu({
  direction,
  image,
  disabled,
}: {
  direction: SketchbookDirection;
  image: SketchbookImage;
  disabled?: boolean;
}) {
  const draw = useDraw();
  const noun = useNoun(image.kind);
  const model = useModel(image.kind);
  const [changing, setChanging] = useState(false);
  const nudge = (instruction: string) =>
    draw(
      {
        kind: image.kind,
        directions: [direction.id],
        count: 1,
        revise: { image: image.path, instruction },
      },
      `${noun}s`,
    );
  const price = model ? (
    <Credits micros={model.priceMicros} className="text-xs text-muted-foreground" />
  ) : null;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="xs"
            variant="ghost"
            disabled={disabled || !model}
            aria-label={`Change this ${noun}`}
          >
            <WandSparkles />
            Nudge
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          <DropdownMenuLabel>Redraw this {noun}</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => nudge(REVISION_NUDGES.bolder)}>
            <span className="flex-1">Bolder</span>
            {price}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => nudge(REVISION_NUDGES.quieter)}>
            <span className="flex-1">Quieter</span>
            {price}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setChanging(true)}>
            <Pencil />
            <span className="flex-1">Change…</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {changing ? (
        <ReviseDialog direction={direction} image={image} onClose={() => setChanging(false)} />
      ) : null}
    </>
  );
}

/** What a revised image was asked to change, under it. */
function RevisionNote({ image }: { image: SketchbookImage }) {
  const text = image.instruction ? revisionLabel(image.instruction) : image.focus;
  if (!text) return null;
  return (
    <p className="line-clamp-2 text-xs text-muted-foreground" title={text}>
      {image.instruction ? `Revised: ${text}` : text}
    </p>
  );
}

/** A page image's tile: chosen ring, its revision note, choose, nudge and delete. */
function PageImageActions({
  direction,
  image,
  busy,
}: {
  direction: SketchbookDirection;
  image: SketchbookImage;
  busy: boolean;
}) {
  const id = useCanvas((s) => s.sketchbookId);
  const remove = (path: string) =>
    void sketchbookApi
      .removeImage(id ?? "", path)
      .then(() => useCanvas.getState().refreshSketchbook())
      .catch((err) => toastError(err, "Could not delete the image"));
  return (
    <>
      <RevisionNote image={image} />
      <div className="flex items-center gap-1">
        <InspirationToggle direction={direction.id} image={image.path} />
        <div className="flex-1" />
        <ReviseMenu direction={direction} image={image} disabled={busy} />
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Delete this image"
          onClick={() => remove(image.path)}
        >
          <Trash2 />
        </Button>
      </div>
    </>
  );
}

function MockRow({
  direction,
  onOpen,
}: {
  direction: SketchbookDirection;
  onOpen: (i: SketchbookImage) => void;
}) {
  const chosen = useCanvas((s) => s.sketchbook?.sketchbook.chosen);
  const draw = useDraw();
  const busy = useBusy(direction.id, "mock");
  const failure = useCanvas((s) => s.sketchbookFailures[direction.id]);
  const board = latestOf(direction, "moodboard");
  const mocks = imagesOf(direction, "mock");
  // Mobile mocks and close-ups are pages too: shown, chosen and revised like mocks.
  const pages = useKindsShown(direction, (k) => k !== "mock" && PAGE_IMAGE_KINDS.includes(k));
  const ringed = (image: SketchbookImage) =>
    chosen?.some((c) => c.image === image.path)
      ? "rounded-lg ring-2 ring-primary ring-offset-2 ring-offset-background"
      : undefined;
  const tile = (image: SketchbookImage) => (
    <div key={image.path} className="flex flex-col gap-1.5">
      <div className={ringed(image)}>
        <ImageTile image={image} busy={false} onOpen={() => onOpen(image)} />
      </div>
      <PageImageActions direction={direction} image={image} busy={busy} />
    </div>
  );
  return (
    <section data-direction={direction.id} className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold">{direction.title}</h2>
        {board && mocks.some((m) => m.fromBoard) ? (
          <Badge variant="secondary">From its mood board</Badge>
        ) : null}
        <div className="flex-1" />
        <MakeLookButton direction={direction} />
        <DrawMenu direction={direction} />
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
        {mocks.map(tile)}
        {busy ? <ImageTile image={undefined} busy kind="mock" /> : null}
      </div>
      {pages.map((kind) => (
        <KindGroup
          key={kind}
          direction={direction}
          kind={kind}
          onOpen={onOpen}
          actions={(image) => <PageImageActions direction={direction} image={image} busy={busy} />}
        />
      ))}
    </section>
  );
}

function MocksStep() {
  const sketchbook = useCanvas((s) => s.sketchbook?.sketchbook);
  const [designing, setDesigning] = useState(false);
  const picked = sketchbook ? activeDirections(sketchbook).filter((d) => d.picked) : [];
  const pageImages = picked.flatMap((d) =>
    d.images.filter((i) => PAGE_IMAGE_KINDS.includes(i.kind)),
  );
  const lightbox = useLightbox(pageImages);
  if (!sketchbook) return null;
  const anyMocks = pageImages.length > 0;
  const chosen = sketchbook.chosen;
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
  const build = useCanvas((s) => s.buildSketchbook);
  const sketchbook = useCanvas((s) => s.sketchbook?.sketchbook);
  const chosen = sketchbook?.chosen ?? [];
  const [images, setImages] = useState<boolean>(sketchbook?.generateImages ?? true);
  const [withBoards, setWithBoards] = useState(sketchbook?.buildWithBoards ?? true);
  const [instructions, setInstructions] = useState(sketchbook?.buildNotes ?? "");
  const [busy, setBusy] = useState(false);
  if (!sketchbook) return null;
  const words = chosenWords(sketchbook);
  // A mock drawn from a mood board can go with it; a chosen mood board is already one.
  const mocksWithBoards = chosen.filter((c) => {
    if (isBoard(sketchbook, c)) return false;
    const d = sketchbook.directions.find((x) => x.id === c.direction);
    return d !== undefined && latestOf(d, "moodboard") !== undefined;
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
              id="sketchbook-with-boards"
              checked={withBoards}
              onCheckedChange={(v) => setWithBoards(v === true)}
            />
            <FieldLabel htmlFor="sketchbook-with-boards" className="font-normal">
              Send {mocksWithBoards === 1 ? "the mock" : "each mock"} with its mood board too
            </FieldLabel>
          </Field>
        ) : null}
        <Field>
          <FieldLabel htmlFor="sketchbook-build-notes">Instructions (optional)</FieldLabel>
          <Textarea
            id="sketchbook-build-notes"
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
  const sketchbook = useCanvas((s) => s.sketchbook?.sketchbook);
  const boards = useCanvas((s) => s.boards);
  const showBuild = useCanvas((s) => s.showSketchbookBuild);
  const [designing, setDesigning] = useState(false);
  const chosen = sketchbook?.chosen ?? [];
  const images = chosen
    .map((c) =>
      sketchbook?.directions
        .find((x) => x.id === c.direction)
        ?.images.find((i) => i.path === c.image),
    )
    .filter((m): m is SketchbookImage => Boolean(m));
  const lightbox = useLightbox(images);
  if (!sketchbook || chosen.length === 0) {
    return (
      <EmptyState
        title="Nothing is chosen yet"
        hint="Use a mock, or a mood board, as inspiration on its step."
      />
    );
  }
  const buildBoard = Object.values(sketchbook.buildBoards)[0];
  const board = buildBoard ? boards[buildBoard] : undefined;
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
          <ImageTile key={m.path} image={m} busy={false} onOpen={() => lightbox.open(m)} />
        ))}
      </div>
      {sketchbook.buildNotes ? (
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Your instructions: </span>
          {sketchbook.buildNotes}
        </p>
      ) : null}
      {lightbox.view}
      {designing ? <DesignDialog onClose={() => setDesigning(false)} /> : null}
    </StepFrame>
  );
}

/** The main area while the sketchbook is open: the step the rail has selected. */
export function SketchbookView() {
  const id = useCanvas((s) => s.sketchbookId);
  const start = useCanvas((s) => s.sketchbookStart);
  const state = useCanvas((s) => s.sketchbook);
  const step = useSketchbookStep();
  if (!id) return start ? <StartPage subject={start} /> : <SketchbookHome />;
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
      // Until the canvas shows each direction's tokens on its card, a Look's are on their own step.
      return state.sketchbook.subject === "look" &&
        activeDirections(state.sketchbook).some((d) => d.proposal) ? (
        <TokensStep />
      ) : (
        <DirectionsStep />
      );
    case "inspiration":
      return <BoardsStep />;
    case "mocks":
      return <MocksStep />;
    case "screens":
      return <ScreensStep />;
  }
}
