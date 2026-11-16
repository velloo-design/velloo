import {
  latestOf,
  mockDirections,
  PAGE_IMAGE_KINDS,
  type SketchbookDirection,
  type SketchbookImage,
  screenDirections,
} from "@velloo/schema";
import { Frame, LayoutGrid, WandSparkles } from "lucide-react";
import { useState } from "react";
import { useCanvas } from "../../store.ts";
import { toastError } from "../../toast.ts";
import { EmptyState } from "../EmptyState.tsx";
import { useLightbox } from "../ImageLightbox.tsx";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../ui/card.tsx";
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
import { designFromDirections } from "./prompts.ts";
import { ImageTile, KeepToggle, ScreenCountPicker, StepFrame } from "./stage-parts.tsx";

/**
 * What the agent is sent for a direction, in the order it reads them: the
 * mood board, the latest of each other kind of inspiration, then every page.
 */
function sentImages(direction: SketchbookDirection): SketchbookImage[] {
  const kinds = [...new Set(direction.images.map((i) => i.kind))]
    .filter((k) => !PAGE_IMAGE_KINDS.includes(k))
    .sort((a, b) => (a === "moodboard" ? -1 : b === "moodboard" ? 1 : 0));
  const inspiration = kinds.flatMap((k) => latestOf(direction, k) ?? []);
  const pages = direction.images.filter((i) => PAGE_IMAGE_KINDS.includes(i.kind));
  return [...inspiration, ...pages];
}

/** A direction kept for mocks: what goes to the agent with it, its board, and keep or drop. */
function DirectionCard({
  direction,
  onOpen,
}: {
  direction: SketchbookDirection;
  onOpen: (i: SketchbookImage) => void;
}) {
  const boardId = useCanvas((s) => s.sketchbook?.sketchbook.buildBoards[direction.id]);
  const board = useCanvas((s) => (boardId ? s.boards[boardId] : undefined));
  const show = useCanvas((s) => s.showSketchbookBuild);
  const update = useCanvas((s) => s.updateSketchbook);
  const kept = direction.toScreens;
  const images = sentImages(direction);
  const keep = (toScreens: boolean) =>
    void update({ directions: [{ id: direction.id, toScreens }] }).catch((err) =>
      toastError(err, "Could not change the direction"),
    );
  return (
    <Card data-direction={direction.id} data-kept={kept}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {direction.title}
          {kept ? null : <Badge variant="outline">Dropped</Badge>}
        </CardTitle>
        <CardDescription className="line-clamp-2">{direction.description}</CardDescription>
        {board && boardId ? (
          <CardAction>
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
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className={kept ? undefined : "opacity-60"}>
        {images.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing drawn for this direction: its screens are designed from its words and tokens.
          </p>
        ) : (
          <div className="grid items-start gap-3 grid-cols-3 md:grid-cols-5 xl:grid-cols-8">
            {images.map((image) => (
              <ImageTile key={image.path} image={image} busy={false} onOpen={() => onOpen(image)} />
            ))}
          </div>
        )}
      </CardContent>
      <CardFooter className="justify-end">
        <KeepToggle title={direction.title} kept={kept} onChange={keep} />
      </CardFooter>
    </Card>
  );
}

/** "3 screens from 2 directions". */
function screensWords(screens: number, directions: number): string {
  const s = `${screens} ${screens === 1 ? "screen" : "screens"}`;
  return directions === 1 ? s : `${s} from ${directions} directions`;
}

/**
 * The directions kept for mocks, each with what its screens are designed
 * from, to keep or drop, and how many screens each. Building makes each kept
 * direction a Look with a board of its own.
 */
export function ScreensStep() {
  const sketchbook = useCanvas((s) => s.sketchbook?.sketchbook);
  const [designing, setDesigning] = useState(false);
  const candidates = sketchbook ? mockDirections(sketchbook) : [];
  const lightbox = useLightbox(candidates.flatMap(sentImages));
  if (!sketchbook) return null;
  const kept = screenDirections(sketchbook).length;
  const n = kept * sketchbook.screenCount;
  const built = Object.keys(sketchbook.buildBoards).length > 0;
  return (
    <StepFrame
      title="Screens"
      ask={`Keep the directions to design screens from (${kept} of ${candidates.length} kept). Your agent designs each one from everything drawn for it: the brief, its words and tokens, its inspiration and its mocks. Each kept direction becomes a Look with its own board. Keep talking to your agent in the Agent tab to take the screens further.`}
      footer={
        <>
          <ScreenCountPicker />
          <span className="text-sm text-muted-foreground">
            {kept === 0 ? "No direction kept" : screensWords(n, kept)}
          </span>
          <div className="flex-1" />
          <Button size="sm" disabled={n === 0} onClick={() => setDesigning(true)}>
            <WandSparkles />
            {n === 0
              ? "Keep a direction to design from"
              : `Design ${n === 1 ? "the screen" : `${n} screens`}${built ? " again" : ""}`}
          </Button>
        </>
      }
    >
      {candidates.length === 0 ? (
        <EmptyState
          title="No direction is kept"
          hint="Keep one on the directions step to design screens from it."
          icon={Frame}
        />
      ) : (
        candidates.map((d) => <DirectionCard key={d.id} direction={d} onOpen={lightbox.open} />)
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
 * Hand the kept directions to the agent, after asking the one thing only the
 * person can decide (whether the screens may spend credits drawing the
 * photographs and illustrations the images show) and anything they want to
 * add. The canvas then shows the board the screens land on.
 */
function DesignDialog({ onClose }: { onClose: () => void }) {
  const build = useCanvas((s) => s.buildSketchbook);
  const sketchbook = useCanvas((s) => s.sketchbook?.sketchbook);
  const [images, setImages] = useState<boolean>(sketchbook?.generateImages ?? true);
  const [instructions, setInstructions] = useState(sketchbook?.buildNotes ?? "");
  const [busy, setBusy] = useState(false);
  if (!sketchbook) return null;
  const directions = screenDirections(sketchbook);
  const count = sketchbook.screenCount;
  const n = directions.length * count;
  const go = () => {
    setBusy(true);
    void build(
      { generateImages: images, count, instructions },
      designFromDirections(
        directions.map((d) => d.title),
        count,
        instructions,
      ),
    )
      .then(onClose)
      .catch((err) => toastError(err, "Could not hand the directions to the agent"))
      .finally(() => setBusy(false));
  };
  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Design {screensWords(n, directions.length)}</DialogTitle>
          <DialogDescription>
            Each kept direction becomes a Look with its tokens, and gets a board of its own pinned
            to it. Your agent designs {count === 1 ? "a screen" : `${count} different takes`} for
            each there, from your components and your design's rules, and you can watch them land.
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
