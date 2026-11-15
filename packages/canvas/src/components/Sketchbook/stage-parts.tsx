import {
  describeSketchbookFailures,
  type IntentPrice,
  REVISION_NUDGES,
  SKETCHBOOK_LIMITS,
  type SketchbookGenerateResult,
} from "@velloo/protocol";
import {
  activeDirections,
  findSketchbookImage,
  imagesOf,
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
  Lock,
  Palette,
  Pencil,
  Plus,
  Shuffle,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { useCanvas } from "../../store.ts";
import { pushToast, toastError } from "../../toast.ts";
import { Credits } from "../Credits.tsx";
import { PlaceComments } from "../PlaceComments.tsx";
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
import { ModelPicker, useKindLabel, useKinds, useModel, useTakesPrompt } from "./ModelPicker.tsx";

/**
 * What the sketchbook's steps share: the frame each is laid out in, an
 * image's tile, drawing and its busy state, the revise menu, the Draw menu,
 * Make this a Look, and moving the stage on.
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

export function useDraw() {
  const generate = useCanvas((s) => s.generateSketchbook);
  return (body: Parameters<typeof generate>[0], noun: string) =>
    void generate(body)
      .then((r) => reportDraw(r, noun))
      .catch((err) => toastError(err, `Could not draw the ${noun}`));
}

export function useBusy(direction: string, kind: string): boolean {
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
export function Failure({ message }: { message: string }) {
  return (
    <p className="flex max-w-md items-start gap-1.5 text-left text-xs text-destructive">
      <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
      {message}
    </p>
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

// --- Choosing what the screens are designed from -----------------------------

const sameChoice =
  (direction: string, image: string | undefined) =>
  (c: { direction: string; image?: string | undefined }) =>
    c.direction === direction && c.image === image;

/** Whether a screen is to be designed from `image` of a direction, or (no image) from the direction alone. */
export function useChosen(direction: string, image?: string): boolean {
  return useCanvas(
    (s) => s.sketchbook?.sketchbook.chosen.some(sameChoice(direction, image)) ?? false,
  );
}

/**
 * Choose a mock, an inspiration image that designs screens, or (with no
 * image) the direction alone, for a screen to be designed from: one screen each.
 */
export function ChoiceToggle({ direction, image }: { direction: string; image?: string }) {
  const chosen = useCanvas((s) => s.sketchbook?.sketchbook.chosen ?? []);
  const update = useCanvas((s) => s.updateSketchbook);
  const on = useChosen(direction, image);
  const same = sameChoice(direction, image);
  return (
    <Button
      size="xs"
      variant={on ? "default" : "outline"}
      aria-pressed={on}
      onClick={() =>
        void update({
          chosen: on
            ? chosen.filter((c) => !same(c))
            : [...chosen, image === undefined ? { direction } : { direction, image }],
        }).catch((err) => toastError(err, "Could not choose it"))
      }
    >
      <Check />
      {on ? "Chosen" : image === undefined ? "Design from the direction" : "Design from this"}
    </Button>
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
export function MakeLookButton({
  direction,
  variant = "ghost",
}: {
  direction: SketchbookDirection;
  variant?: "ghost" | "default";
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
export function DrawMenu({
  direction,
  disabled,
}: {
  direction: SketchbookDirection;
  disabled?: boolean;
}) {
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
  const busy = useBusy(direction.id, kind);
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
        {busy ? <ImageTile image={undefined} busy kind={kind} /> : null}
      </div>
    </section>
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

export function DrawMocksButton() {
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
export function ReviseMenu({
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
export function RevisionNote({ image }: { image: SketchbookImage }) {
  const text = image.instruction ? revisionLabel(image.instruction) : image.focus;
  if (!text) return null;
  return (
    <p className="line-clamp-2 text-xs text-muted-foreground" title={text}>
      {image.instruction ? `Revised: ${text}` : text}
    </p>
  );
}

/** An image's revision note and its nudges, under its tile. */
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
    </div>
  );
}
