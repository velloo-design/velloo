import {
  imagesOf,
  latestOf,
  mockDirections,
  PAGE_IMAGE_KINDS,
  type SketchbookDirection,
  type SketchbookImage,
} from "@velloo/schema";
import { LayoutTemplate, Plus, Trash2, WandSparkles } from "lucide-react";
import { sketchbook as sketchbookApi } from "../../api/sketchbook.ts";
import { useCanvas } from "../../store.ts";
import { toastError } from "../../toast.ts";
import { EmptyState } from "../EmptyState.tsx";
import { useLightbox } from "../ImageLightbox.tsx";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { ModelPicker } from "./ModelPicker.tsx";
import {
  DrawMenu,
  DrawMocksButton,
  Failure,
  ImageTile,
  KindGroup,
  MakeLookButton,
  MockCountPicker,
  ReviseMenu,
  RevisionNote,
  StepFrame,
  useBusy,
  useDraw,
  useKindsShown,
  useMoveTo,
} from "./stage-parts.tsx";

/** A page image's tile: its revision note, nudge and delete. */
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
  const draw = useDraw();
  const busy = useBusy(direction.id, "mock");
  const failure = useCanvas((s) => s.sketchbookFailures[direction.id]);
  const board = latestOf(direction, "moodboard");
  const mocks = imagesOf(direction, "mock");
  // Mobile mocks and close-ups are pages too: shown and revised like mocks.
  const pages = useKindsShown(direction, (k) => k !== "mock" && PAGE_IMAGE_KINDS.includes(k));
  const tile = (image: SketchbookImage) => (
    <div key={image.path} className="flex flex-col gap-1.5">
      <ImageTile image={image} busy={false} onOpen={() => onOpen(image)} />
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

/**
 * The mocks drawn for each kept direction, from its words and any
 * inspiration: open, revise, draw more, and choose the ones to design from.
 */
export function MocksStep() {
  const sketchbook = useCanvas((s) => s.sketchbook?.sketchbook);
  const moveTo = useMoveTo();
  const picked = sketchbook ? mockDirections(sketchbook) : [];
  const pageImages = picked.flatMap((d) =>
    d.images.filter((i) => PAGE_IMAGE_KINDS.includes(i.kind)),
  );
  const lightbox = useLightbox(pageImages);
  if (!sketchbook) return null;
  const anyMocks = pageImages.length > 0;
  return (
    <StepFrame
      title="Mocks"
      ask="Open any mock at full size, revise one in words, draw more of a direction you like, and choose the ones to design from. Your agent designs a screen from each in its look, with your components and your design's rules: a starting point, not a copy."
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
            variant={anyMocks ? "default" : "outline"}
            disabled={picked.length === 0}
            onClick={() => moveTo("screens")}
          >
            <WandSparkles />
            Design screens
          </Button>
        </>
      }
    >
      {picked.length === 0 ? (
        <EmptyState
          title="No direction is kept"
          hint="Keep one on the directions step to draw its mocks."
          icon={LayoutTemplate}
        />
      ) : (
        picked.map((d) => <MockRow key={d.id} direction={d} onOpen={lightbox.open} />)
      )}
      {lightbox.view}
    </StepFrame>
  );
}
