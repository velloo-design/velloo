import {
  REVISION_NUDGES,
  SKETCHBOOK_LIMITS,
  type SketchbookFailure,
  type SketchbookGenerateResult,
  type SketchbookPending,
} from "@velloo/protocol";
import {
  findSketchbookImage,
  imagesOf,
  mockDirections,
  PAGE_IMAGE_KINDS,
  SKETCHBOOK_STAGES,
  type SketchbookDirection,
  type SketchbookImage,
  type SketchbookStage,
} from "@velloo/schema";
import {
  Check,
  ChevronDown,
  CircleAlert,
  Eye,
  EyeOff,
  Lock,
  Palette,
  Pencil,
  Plus,
  RotateCw,
  Shuffle,
  Sparkles,
  Square,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { sketchbook as sketchbookApi } from "../../api/sketchbook.ts";
import { useCanvas } from "../../store.ts";
import { pushToast, toastError } from "../../toast.ts";
import { Credits } from "../Credits.tsx";
import { PlaceComments } from "../PlaceComments.tsx";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { CardDescription } from "../ui/card.tsx";
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
import { Field, FieldLabel } from "../ui/field.tsx";
import { NativeSelect, NativeSelectOption } from "../ui/native-select.tsx";
import { Spinner } from "../ui/spinner.tsx";
import { Textarea } from "../ui/textarea.tsx";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group.tsx";
import {
  type KindChoice,
  ModelPicker,
  NOT_ON_CLOUD,
  useKindChoices,
  useKindLabel,
  useKinds,
  useModel,
  useTakesPrompt,
} from "./ModelPicker.tsx";

/**
 * What the sketchbook's steps share: the frame each is laid out in, an
 * image's tile, drawing and its busy state, the revise menu, the Draw menu,
 * Make a theme look, and moving the stage on.
 */

const src = (image: SketchbookImage) => `/${image.path}`;

/** The shape each kind is drawn at, for its tile before and after it lands. */
const ASPECT: Record<string, string> = {
  mock: "aspect-[9/16]",
  mobile: "aspect-[9/16]",
  typeposter: "aspect-[2/3]",
  icons: "aspect-square",
};
const aspectOf = (kind: string) => ASPECT[kind] ?? "aspect-[3/2]";

/**
 * Say what a draw produced, cost included: every image is paid for. Each
 * image that failed has its own tile, with why and a Retry, so the toast only
 * says how many.
 */
function reportDraw(result: SketchbookGenerateResult, noun: string) {
  const made = result.made.length;
  const failed = result.failed.length;
  const one = (n: number) => (n === 1 ? noun.replace(/s$/, "") : noun);
  if (failed > 0) {
    toastError(
      `${failed} ${one(failed)} couldn't be drawn. Each shows where it would be, with why and a Retry.`,
      made > 0 ? `${made} drawn, ${failed} failed` : `No ${noun} could be drawn`,
    );
  }
  if (made > 0 && failed === 0) {
    pushToast({
      kind: "success",
      message: `${made} ${one(made)} drawn${result.cost ? `: ${result.cost}` : ""}.`,
    });
  }
}

export function useDraw() {
  const generate = useCanvas((s) => s.generateSketchbook);
  return (body: Parameters<typeof generate>[0], noun: string) =>
    void generate(body)
      .then((r) => reportDraw(r, noun))
      .catch((err) => toastError(err, `Could not draw the ${noun}`));
}

export function useBusy(direction: string, kind: string): boolean {
  return useDrawingCount(direction, kind) > 0;
}

/**
 * How many of a direction's images of one kind are still to land: the
 * server's count, or one while this canvas waits for the server to report it.
 */
function useDrawingCount(direction: string, kind: string): number {
  const pending = useCanvas((s) =>
    (s.sketchbook?.pending ?? [])
      .filter((p) => p.direction === direction && p.kind === kind)
      .reduce((n, p) => n + p.count, 0),
  );
  const local = useCanvas((s) => s.sketchbookBusy.includes(`${kind}:${direction}`));
  return pending > 0 ? pending : local ? 1 : 0;
}

const NONE_PENDING: SketchbookPending[] = [];

/** Everything being drawn on the open sketchbook, by this canvas or anyone. */
export function useDrawing(): { images: number; stopping: boolean } {
  const pending = useCanvas((s) => s.sketchbook?.pending) ?? NONE_PENDING;
  const local = useCanvas((s) => s.sketchbookBusy);
  const reported = new Set(pending.map((p) => `${p.kind}:${p.direction}`));
  const images =
    pending.reduce((n, p) => n + p.count, 0) + local.filter((b) => !reported.has(b)).length;
  return {
    images,
    stopping: pending.length > 0 && pending.every((p) => p.stopping),
  };
}

/** The kinds being drawn for a direction right now, by this canvas or anyone, or that failed. */
function useBusyKinds(direction: string): string[] {
  const pending = useCanvas((s) => s.sketchbook?.pending);
  const failures = useCanvas((s) => s.sketchbook?.failures);
  const local = useCanvas((s) => s.sketchbookBusy);
  return [
    ...new Set([
      ...(pending ?? []).filter((p) => p.direction === direction).map((p) => p.kind),
      ...(failures ?? []).filter((f) => f.direction === direction).map((f) => f.kind),
      ...local.filter((b) => b.endsWith(`:${direction}`)).map((b) => b.split(":")[0] as string),
    ]),
  ];
}

/**
 * The footer's word on a draw in progress: how many images are still coming,
 * and Stop, which drops the ones not yet sent (the image model's already
 * started ones still land, being paid for).
 */
function DrawingStatus() {
  const { images, stopping } = useDrawing();
  const stop = useCanvas((s) => s.stopSketchbookDraws);
  const [asked, setAsked] = useState(false);
  if (images === 0) return null;
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground" data-drawing={images}>
      <Spinner />
      {stopping
        ? `Stopping: ${images} already being drawn ${images === 1 ? "lands" : "land"}`
        : `Drawing ${images} ${images === 1 ? "image" : "images"}…`}
      {stopping ? null : (
        <Button
          size="sm"
          variant="outline"
          disabled={asked}
          title="Images not yet sent aren't drawn or charged. Ones the image model has started still land and are paid for."
          onClick={() => {
            setAsked(true);
            void stop()
              .catch((err) => toastError(err, "Could not stop drawing"))
              .finally(() => setAsked(false));
          }}
        >
          <Square />
          Stop
        </Button>
      )}
    </div>
  );
}

export function StepFrame({
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
            <DrawingStatus />
            {footer}
          </div>
        </footer>
      ) : null}
    </div>
  );
}

/** Which two directions a remix came from, and what it takes. */
export function RemixOf({ direction }: { direction: SketchbookDirection }) {
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

/**
 * Move the sketchbook on to `stage` and show it. The stage only goes forward
 * here: going back to look at an earlier step is the rail's.
 */
export function useMoveTo() {
  const update = useCanvas((s) => s.updateSketchbook);
  const setStep = useCanvas((s) => s.setSketchbookStep);
  return (stage: SketchbookStage, failure = "Could not move on") => {
    const current = useCanvas.getState().sketchbook?.sketchbook.stage ?? "brief";
    const forward = SKETCHBOOK_STAGES.indexOf(stage) > SKETCHBOOK_STAGES.indexOf(current);
    setStep(stage);
    if (forward) void update({ stage }).catch((err) => toastError(err, failure));
  };
}

export function ImageTile({
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
            className={`size-full ${tall ? "object-cover object-top" : "object-cover"} ${image.excluded ? "opacity-40 grayscale" : ""}`}
          />
        </button>
      ) : null}
      {image?.excluded ? (
        <Badge variant="outline" className="absolute left-2 top-2 bg-background/90">
          Left out
        </Badge>
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
export function MakeLookButton({
  direction,
  variant = "ghost",
}: {
  direction: SketchbookDirection;
  variant?: "ghost" | "default" | "secondary";
}) {
  const id = useCanvas((s) => s.sketchbookId);
  const makeLook = useCanvas((s) => s.makeLook);
  const [busy, setBusy] = useState(false);
  if (!id || (!direction.proposal && direction.images.length === 0)) return null;
  const go = async () => {
    setBusy(true);
    try {
      const { name, draft } = await makeLook(id, direction);
      pushToast({
        kind: "info",
        message: draft
          ? `"${name}" is a draft theme look with the proposed tokens. Refine it, then Done keeps it.`
          : `"${name}" is a theme look now. Boards can use it from the Theme looks rail.`,
      });
    } catch (err) {
      toastError(err, "Could not make the theme look");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant={variant} size="sm" disabled={busy} onClick={() => void go()}>
      {busy ? <Spinner /> : <Palette />}
      Make a theme look
    </Button>
  );
}

/** One kind in the Draw menu: its label, its price on the model it would run on, its lock. */
function DrawMenuItem({ kind, onDraw }: { kind: KindChoice; onDraw: () => void }) {
  const model = useModel(kind.intent);
  const label = useKindLabel(kind.intent);
  const offer = kind.offer;
  const locked = Boolean(offer?.locked || model?.locked);
  const price = model?.priceMicros ?? offer?.priceMicros ?? 0;
  return (
    <DropdownMenuItem
      disabled={!offer || locked}
      onSelect={onDraw}
      title={offer ? offer.summary : NOT_ON_CLOUD}
      data-unavailable={offer ? undefined : true}
    >
      <span className="flex-1 whitespace-nowrap">{label}</span>
      {!offer ? (
        <span className="text-xs whitespace-nowrap text-muted-foreground">
          Not on your cloud yet
        </span>
      ) : locked ? (
        <Lock aria-label="Add credits to unlock" />
      ) : price > 0 ? (
        <Credits micros={price} className="text-xs text-muted-foreground" />
      ) : null}
    </DropdownMenuItem>
  );
}

/**
 * Draw one image of any kind Velloo knows for a direction: a palette, a type
 * poster, a mobile mock… Each is drawn from the direction's mood board when
 * it has one. A kind the cloud doesn't draw yet is listed, unavailable.
 */
export function DrawMenu({
  direction,
  disabled,
}: {
  direction: SketchbookDirection;
  disabled?: boolean;
}) {
  // A custom image needs its words, which the directions step's picker takes.
  const kinds = useKindChoices().filter((k) => k.intent !== "custom");
  const models = useCanvas((s) => s.sketchbookModels);
  const draw = useDraw();
  if (!models) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" disabled={disabled}>
          <Plus />
          Draw
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-56">
        <DropdownMenuLabel>Draw “{direction.title}” as</DropdownMenuLabel>
        {kinds.map((k) => (
          <DrawMenuItem
            key={k.intent}
            kind={k}
            onDraw={() =>
              draw(
                { kind: k.intent, directions: [direction.id], count: 1 },
                (k.offer?.label ?? k.intent).toLowerCase(),
              )
            }
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A direction's images of one kind, under the kind's name, with a tile for one being drawn. */
export function KindGroup({
  direction,
  kind,
  onOpen,
  actions,
  action,
}: {
  direction: SketchbookDirection;
  kind: string;
  onOpen: (i: SketchbookImage) => void;
  actions?: (image: SketchbookImage) => ReactNode;
  /** Beside the kind's name: what the whole group offers, such as drawing another. */
  action?: ReactNode;
}) {
  const label = useKindLabel(kind);
  const images = imagesOf(direction, kind);
  const tall = kind === "mock" || kind === "mobile" || kind === "typeposter";
  return (
    <section data-kind={kind} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 className="flex-1 text-xs font-medium text-muted-foreground">
          {label}
          {images.length > 1 ? ` · ${images.length}` : ""}
        </h3>
        {action}
      </div>
      <div
        className={`grid gap-3 ${tall ? "grid-cols-2 md:grid-cols-3 xl:grid-cols-4" : "grid-cols-2 md:grid-cols-3"}`}
      >
        {images.map((image) => (
          <div key={image.path} className="flex flex-col gap-1.5">
            <ImageTile image={image} busy={false} onOpen={() => onOpen(image)} />
            {actions?.(image)}
          </div>
        ))}
        <DrawTiles direction={direction.id} kind={kind} />
      </div>
    </section>
  );
}

/**
 * Where a direction's images of one kind are still to come: a tile for each
 * one being drawn, then one for each that couldn't be, saying why, to retry
 * or dismiss.
 */
export function DrawTiles({ direction, kind }: { direction: string; kind: string }) {
  const drawing = useDrawingCount(direction, kind);
  const all = useCanvas((s) => s.sketchbook?.failures);
  const failures = (all ?? []).filter((f) => f.direction === direction && f.kind === kind);
  return (
    <>
      {Array.from({ length: drawing }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the tiles are alike; only their number changes
        <ImageTile key={`drawing-${i}`} image={undefined} busy kind={kind} />
      ))}
      {failures.map((f) => (
        <FailedTile key={f.id} failure={f} />
      ))}
    </>
  );
}

/** An image that couldn't be drawn, where it would be: why, Retry, and Dismiss. */
function FailedTile({ failure }: { failure: SketchbookFailure }) {
  const retry = useCanvas((s) => s.retrySketchbookFailure);
  const dismiss = useCanvas((s) => s.dismissSketchbookFailure);
  const noun = useNoun(failure.kind).replace(/s$/, "");
  return (
    <div className="flex flex-col gap-1.5" data-failed={failure.id}>
      <div
        className={`flex flex-col items-center justify-center gap-2 overflow-hidden rounded-lg border border-dashed border-destructive/50 bg-destructive/5 p-3 text-center ${aspectOf(failure.kind)}`}
      >
        <CircleAlert className="size-5 text-destructive" aria-hidden />
        <p className="text-xs font-medium">This {noun} couldn't be drawn</p>
        <p className="line-clamp-5 text-xs text-muted-foreground" title={failure.message}>
          {failure.message}
        </p>
      </div>
      <div className="flex items-center justify-end gap-1">
        <Button
          size="xs"
          variant="outline"
          onClick={() =>
            void retry(failure)
              .then((r) => reportDraw(r, `${noun}s`))
              .catch((err) => toastError(err, `Could not draw the ${noun} again`))
          }
        >
          <RotateCw />
          Retry
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={`Dismiss the failed ${noun}`}
          title="Dismiss"
          onClick={() =>
            void dismiss(failure.id).catch((err) => toastError(err, "Could not dismiss it"))
          }
        >
          <X />
        </Button>
      </div>
    </div>
  );
}

/** The kinds a direction has drawn (or is drawing) that `keep` lets through, in the cloud's order. */
export function useKindsShown(
  direction: SketchbookDirection,
  keep: (kind: string) => boolean,
): string[] {
  const listed = useKinds().map((k) => k.intent);
  const busy = useBusyKinds(direction.id);
  const present = [...new Set([...direction.images.map((i) => i.kind), ...busy])].filter(keep);
  const at = (k: string) => (listed.includes(k) ? listed.indexOf(k) : listed.length);
  return present.sort((a, b) => at(a) - at(b));
}

export function MockCountPicker() {
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

/** How many screens are designed from each kept direction. */
export function ScreenCountPicker() {
  const count = useCanvas((s) => s.sketchbook?.sketchbook.screenCount ?? 1);
  const update = useCanvas((s) => s.updateSketchbook);
  return (
    <NativeSelect
      size="sm"
      aria-label="Screens per direction"
      value={String(count)}
      onChange={(e) =>
        void update({ screenCount: Number(e.target.value) }).catch((err) =>
          toastError(err, "Could not change the number of screens"),
        )
      }
    >
      {[1, 2, 3, 4].map((n) => (
        <NativeSelectOption key={n} value={String(n)}>
          {n} {n === 1 ? "screen" : "screens"} each
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

/** Keep or drop a direction at a step: Keep goes on to the next, Drop stops it there. */
export function KeepToggle({
  title,
  kept,
  onChange,
}: {
  title: string;
  kept: boolean;
  onChange: (kept: boolean) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      spacing={0}
      aria-label={`Keep or drop ${title}`}
      value={kept ? "keep" : "drop"}
      onValueChange={(v) => (v === "keep" || v === "drop" ? onChange(v === "keep") : null)}
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
  );
}

export function DrawMocksButton() {
  const sketchbook = useCanvas((s) => s.sketchbook?.sketchbook);
  const moveTo = useMoveTo();
  const drawing = useDrawing().images > 0;
  const draw = useDraw();
  const model = useModel("mock");
  const fits = useTakesPrompt("mock", model);
  if (!sketchbook) return null;
  const n = mockDirections(sketchbook).length * sketchbook.mockCount;
  if (!fits && model) {
    return (
      <Button size="sm" disabled title="Shorten the brief's copy, or pick another model.">
        The copy is too long for {model.label}
      </Button>
    );
  }
  return (
    <Button
      size="sm"
      disabled={n === 0 || !model || drawing}
      onClick={() => {
        draw({ kind: "mock" }, "mocks");
        // On to the mocks at once, so the step (and its tiles drawing) is there to go back to.
        moveTo("mocks");
      }}
    >
      <Sparkles />
      {n === 0 ? (
        "Keep a direction to continue"
      ) : (
        <>
          Draw {n} mock{n === 1 ? "" : "s"}
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

/**
 * Leave an image out of the set (it stays, but nothing is drawn from it, and
 * it goes to neither the screens nor a Look) or bring it back; or delete it.
 */
export function LeaveOutToggle({ image }: { image: SketchbookImage }) {
  const update = useCanvas((s) => s.updateSketchbook);
  const out = image.excluded;
  return (
    <Button
      size="icon-xs"
      variant="ghost"
      aria-pressed={out}
      aria-label={out ? "Use this image again" : "Leave this image out"}
      title={out ? "Use this image again" : "Leave this image out"}
      onClick={() =>
        void update({ images: [{ path: image.path, excluded: !out }] }).catch((err) =>
          toastError(err, "Could not change the image"),
        )
      }
    >
      {out ? <EyeOff /> : <Eye />}
    </Button>
  );
}

function SetControls({ image }: { image: SketchbookImage }) {
  const id = useCanvas((s) => s.sketchbookId);
  return (
    <>
      <LeaveOutToggle image={image} />
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label="Delete this image"
        title="Delete this image"
        onClick={() =>
          void sketchbookApi
            .removeImage(id ?? "", image.path)
            .then(() => useCanvas.getState().refreshSketchbook())
            .catch((err) => toastError(err, "Could not delete the image"))
        }
      >
        <Trash2 />
      </Button>
    </>
  );
}

/** An image's revision note, its nudges, and leaving it out or deleting it, under its tile. */
export function ImageActions({
  direction,
  image,
  disabled,
  children,
}: {
  direction: SketchbookDirection;
  image: SketchbookImage;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1">
      <div className="min-w-0 flex-1">
        <RevisionNote image={image} />
      </div>
      {children}
      <ReviseMenu direction={direction} image={image} disabled={disabled ?? false} />
      <SetControls image={image} />
    </div>
  );
}
