import {
  activeDirections,
  designsScreens,
  type SketchbookDirection,
  type SketchbookImage,
} from "@velloo/schema";
import { Compass, LayoutGrid, Monitor, WandSparkles } from "lucide-react";
import { useState } from "react";
import { useCanvas } from "../../store.ts";
import { toastError } from "../../toast.ts";
import { EmptyState } from "../EmptyState.tsx";
import { useLightbox } from "../ImageLightbox.tsx";
import { Button } from "../ui/button.tsx";
import { Checkbox } from "../ui/checkbox.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.tsx";
import { Field, FieldLabel } from "../ui/field.tsx";
import { Spinner } from "../ui/spinner.tsx";
import { Textarea } from "../ui/textarea.tsx";
import { ChoiceCards } from "./ChoiceCards.tsx";
import { chosenWords, isBoard } from "./chosen.ts";
import { designFromImages } from "./prompts.ts";
import { ChoiceToggle, ImageTile, StepFrame, useChosen } from "./stage-parts.tsx";

const ringed = (on: boolean) =>
  on ? "rounded-lg ring-2 ring-primary ring-offset-2 ring-offset-background" : undefined;

/** The colours a proposal sets, for the direction-alone tile: up to six of them. */
const swatches = (d: SketchbookDirection): string[] =>
  Object.entries(d.proposal?.tokens ?? {})
    .filter(([k, v]) => k.startsWith("colors.") && typeof v === "string")
    .map(([, v]) => v as string)
    .filter((v, i, all) => all.indexOf(v) === i)
    .slice(0, 6);

/** Design a screen from the direction itself: its words, its tokens and the brief. */
function DirectionAlone({ direction }: { direction: SketchbookDirection }) {
  const on = useChosen(direction.id);
  const colours = swatches(direction);
  return (
    <div className="flex flex-col gap-1.5" data-choice="direction">
      <div className={ringed(on)}>
        <div className="flex aspect-[3/2] flex-col gap-2 overflow-hidden rounded-lg border bg-muted p-3">
          <span className="flex items-center gap-1.5 text-xs font-medium">
            <Compass className="size-3.5" aria-hidden />
            The direction alone
          </span>
          <p className="line-clamp-4 text-xs text-muted-foreground">{direction.description}</p>
          {colours.length > 0 ? (
            <span className="mt-auto flex gap-1">
              {colours.map((c) => (
                <span
                  key={c}
                  className="size-4 rounded-sm ring-1 ring-border"
                  style={{ background: c }}
                />
              ))}
            </span>
          ) : null}
        </div>
      </div>
      <ChoiceToggle direction={direction.id} />
    </div>
  );
}

function ImageChoice({
  direction,
  image,
  onOpen,
}: {
  direction: SketchbookDirection;
  image: SketchbookImage;
  onOpen: (i: SketchbookImage) => void;
}) {
  const on = useChosen(direction.id, image.path);
  return (
    <div className="flex flex-col gap-1.5" data-choice={image.kind}>
      <div className={ringed(on)}>
        <ImageTile image={image} busy={false} onOpen={() => onOpen(image)} />
      </div>
      <ChoiceToggle direction={direction.id} image={image.path} />
    </div>
  );
}

/** A kept direction's choices (the direction alone, then each image a screen can be designed from) and its board. */
function DirectionChoices({
  direction,
  onOpen,
}: {
  direction: SketchbookDirection;
  onOpen: (i: SketchbookImage) => void;
}) {
  const boardId = useCanvas((s) => s.sketchbook?.sketchbook.buildBoards[direction.id]);
  const board = useCanvas((s) => (boardId ? s.boards[boardId] : undefined));
  const show = useCanvas((s) => s.showSketchbookBuild);
  const images = direction.images.filter((i) => designsScreens(i.kind));
  return (
    <section data-direction={direction.id} className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold">{direction.title}</h2>
        <div className="flex-1" />
        {board && boardId ? (
          <Button
            variant="outline"
            size="sm"
            data-build-board={boardId}
            onClick={() =>
              void show(boardId).catch((err) => toastError(err, "Could not open the board"))
            }
          >
            <LayoutGrid />
            Open the board “{board.name}”
          </Button>
        ) : null}
      </div>
      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
        <DirectionAlone direction={direction} />
        {images.map((image) => (
          <ImageChoice key={image.path} direction={direction} image={image} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}

/**
 * What each screen is designed from, per kept direction: a mock, an
 * inspiration image that designs screens, or the direction alone. Building
 * makes each chosen direction a Look with a board of its own.
 */
export function ScreensStep() {
  const sketchbook = useCanvas((s) => s.sketchbook?.sketchbook);
  const [designing, setDesigning] = useState(false);
  const picked = sketchbook ? activeDirections(sketchbook).filter((d) => d.picked) : [];
  const lightbox = useLightbox(
    picked.flatMap((d) => d.images.filter((i) => designsScreens(i.kind))),
  );
  if (!sketchbook) return null;
  const n = sketchbook.chosen.length;
  const built = Object.keys(sketchbook.buildBoards).length > 0;
  return (
    <StepFrame
      title="Screens"
      ask="Choose what each screen is designed from: a mock, an image, or the direction alone, with its words and tokens. Each choice is one screen; each direction you choose from becomes a Look with its own board. Keep talking to your agent in the Agent tab to take the screens further."
      footer={
        <>
          <span className="text-sm text-muted-foreground">
            {n === 0
              ? "Nothing chosen yet"
              : `${n} ${n === 1 ? "screen" : "screens"} from ${chosenWords(sketchbook)}`}
          </span>
          <div className="flex-1" />
          <Button size="sm" disabled={n === 0} onClick={() => setDesigning(true)}>
            <WandSparkles />
            {n === 0
              ? "Choose what to design from"
              : built
                ? `Design ${n === 1 ? "the screen" : `${n} screens`} again`
                : `Design ${n === 1 ? "the screen" : `${n} screens`}`}
          </Button>
        </>
      }
    >
      {picked.length === 0 ? (
        <EmptyState
          title="No direction is kept"
          hint="Keep one on the directions step to design screens from it."
          icon={Monitor}
        />
      ) : (
        picked.map((d) => <DirectionChoices key={d.id} direction={d} onOpen={lightbox.open} />)
      )}
      {sketchbook.buildNotes ? (
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Your instructions: </span>
          {sketchbook.buildNotes}
        </p>
      ) : null}
      {lightbox.view}
      {designing && n > 0 ? <DesignDialog onClose={() => setDesigning(false)} /> : null}
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
  // A chosen mock can go with its direction's inspiration; a chosen mood board is already one.
  const mocksWithBoards = chosen.filter((c) => {
    if (c.image === undefined || isBoard(sketchbook, c)) return false;
    const d = sketchbook.directions.find((x) => x.id === c.direction);
    return d?.images.some((i) => !designsScreens(i.kind) || i.kind === "moodboard") ?? false;
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
            Each chosen direction becomes a Look with its tokens, and gets a board of its own pinned
            to it. Your agent designs a screen for each choice there, from your components and your
            design's rules, and you can watch it land.
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
              Send {mocksWithBoards === 1 ? "the mock" : "each mock"} with its direction's
              inspiration too
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
