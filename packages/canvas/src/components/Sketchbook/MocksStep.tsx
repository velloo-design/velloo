import {
  imagesOf,
  latestOf,
  mockDirections,
  PAGE_IMAGE_KINDS,
  type SketchbookDirection,
  type SketchbookImage,
  screenDirections,
} from "@velloo/schema";
import { LayoutTemplate, Plus, WandSparkles } from "lucide-react";
import { useCanvas } from "../../store.ts";
import { toastError } from "../../toast.ts";
import { EmptyState } from "../EmptyState.tsx";
import { useLightbox } from "../ImageLightbox.tsx";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Card, CardAction, CardContent, CardFooter, CardHeader, CardTitle } from "../ui/card.tsx";
import { ModelPicker } from "./ModelPicker.tsx";
import {
  DrawMocksButton,
  Failure,
  ImageActions,
  ImageTile,
  KeepToggle,
  KindGroup,
  MockCountPicker,
  RemixOf,
  StepFrame,
  useBusy,
  useDraw,
  useKindsShown,
  useMoveTo,
} from "./stage-parts.tsx";

function MockCard({
  direction,
  onOpen,
}: {
  direction: SketchbookDirection;
  onOpen: (i: SketchbookImage) => void;
}) {
  const draw = useDraw();
  const update = useCanvas((s) => s.updateSketchbook);
  const busy = useBusy(direction.id, "mock");
  const failure = useCanvas((s) => s.sketchbookFailures[direction.id]);
  const board = latestOf(direction, "moodboard");
  const mocks = imagesOf(direction, "mock");
  // Mobile mocks and close-ups drawn before are pages too: shown and revised like mocks.
  const pages = useKindsShown(direction, (k) => k !== "mock" && PAGE_IMAGE_KINDS.includes(k));
  const kept = direction.toScreens;
  const keep = (toScreens: boolean) =>
    void update({ directions: [{ id: direction.id, toScreens }] }).catch((err) =>
      toastError(err, "Could not change the direction"),
    );
  const actions = (image: SketchbookImage) => (
    <ImageActions direction={direction} image={image} disabled={busy} />
  );
  return (
    <Card data-direction={direction.id} data-kept={kept}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {direction.title}
          {board && mocks.some((m) => m.fromBoard) ? (
            <Badge variant="secondary">From its mood board</Badge>
          ) : null}
          {kept ? null : <Badge variant="outline">Dropped</Badge>}
        </CardTitle>
        <RemixOf direction={direction} />
        <CardAction>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => draw({ kind: "mock", directions: [direction.id], count: 1 }, "mocks")}
          >
            <Plus />
            Draw another
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className={`flex flex-col gap-5 ${kept ? "" : "opacity-60"}`}>
        {failure && !busy ? <Failure message={failure} /> : null}
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          {mocks.map((image) => (
            <div key={image.path} className="flex flex-col gap-1.5">
              <ImageTile image={image} busy={false} onOpen={() => onOpen(image)} />
              {actions(image)}
            </div>
          ))}
          {busy ? <ImageTile image={undefined} busy kind="mock" /> : null}
        </div>
        {pages.map((kind) => (
          <KindGroup
            key={kind}
            direction={direction}
            kind={kind}
            onOpen={onOpen}
            actions={actions}
          />
        ))}
      </CardContent>
      <CardFooter className="justify-end">
        <KeepToggle title={direction.title} kept={kept} onChange={keep} />
      </CardFooter>
    </Card>
  );
}

/**
 * The mocks drawn for each direction kept past inspiration: open, revise,
 * draw more, leave one out of the set or delete it, and keep or drop the
 * direction for the screens.
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
  const kept = screenDirections(sketchbook).length;
  return (
    <StepFrame
      title="Mocks"
      ask={`Open any mock at full size, revise one in words, draw more of a direction you like, and leave out the ones that miss. Keep the directions worth designing screens from (${kept} of ${picked.length} kept): each mock left in goes to your agent with them.`}
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
            disabled={kept === 0}
            onClick={() => moveTo("screens")}
          >
            <WandSparkles />
            {kept === 0 ? "Keep a direction to continue" : "Design screens"}
          </Button>
        </>
      }
    >
      {picked.length === 0 ? (
        <EmptyState
          title="No direction is kept"
          hint="Keep one on the inspiration step to draw its mocks."
          icon={LayoutTemplate}
        />
      ) : (
        picked.map((d) => <MockCard key={d.id} direction={d} onOpen={lightbox.open} />)
      )}
      {lightbox.view}
    </StepFrame>
  );
}
