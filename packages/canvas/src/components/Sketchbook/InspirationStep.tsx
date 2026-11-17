import {
  activeDirections,
  latestOf,
  mockDirections,
  PAGE_IMAGE_KINDS,
  type SketchbookDirection,
  type SketchbookImage,
} from "@velloo/schema";
import { Palette, RefreshCw } from "lucide-react";
import { useCanvas } from "../../store.ts";
import { toastError } from "../../toast.ts";
import { EmptyState } from "../EmptyState.tsx";
import { useLightbox } from "../ImageLightbox.tsx";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Card, CardAction, CardContent, CardFooter, CardHeader, CardTitle } from "../ui/card.tsx";
import { ModelPicker, useKindLabel } from "./ModelPicker.tsx";
import {
  DrawMenu,
  DrawMocksButton,
  ImageActions,
  KeepToggle,
  KindGroup,
  MockCountPicker,
  RemixOf,
  StepFrame,
  useBusy,
  useDraw,
  useDrawing,
  useKindsShown,
  useMoveTo,
} from "./stage-parts.tsx";

/** The kinds the inspiration step shows: anything that isn't a page, which the mocks step has. */
const isInspirationKind = (kind: string) => !PAGE_IMAGE_KINDS.includes(kind);

/** Draw one more of a kind for a direction: a custom image again with the same words. */
function DrawAgain({ direction, kind }: { direction: SketchbookDirection; kind: string }) {
  const draw = useDraw();
  const busy = useBusy(direction.id, kind);
  const label = useKindLabel(kind);
  const ask = latestOf(direction, kind)?.ask;
  return (
    <Button
      variant="ghost"
      size="xs"
      disabled={busy}
      aria-label={`Draw another ${label.toLowerCase()}`}
      onClick={() =>
        draw(
          {
            kind,
            directions: [direction.id],
            count: 1,
            ...(kind === "custom" && ask ? { ask } : {}),
          },
          `${label.toLowerCase()}s`,
        )
      }
    >
      <RefreshCw />
      Regenerate
    </Button>
  );
}

function InspirationCard({
  direction,
  onOpen,
}: {
  direction: SketchbookDirection;
  onOpen: (i: SketchbookImage) => void;
}) {
  const update = useCanvas((s) => s.updateSketchbook);
  const kinds = useKindsShown(direction, isInspirationKind);
  const kept = direction.toMocks;
  const keep = (toMocks: boolean) =>
    void update({ directions: [{ id: direction.id, toMocks }] }).catch((err) =>
      toastError(err, "Could not change the direction"),
    );
  return (
    <Card data-direction={direction.id} data-kept={kept}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {direction.title}
          {kept ? null : <Badge variant="outline">Dropped</Badge>}
        </CardTitle>
        <RemixOf direction={direction} />
        <CardAction className="flex items-center gap-1">
          <DrawMenu direction={direction} />
        </CardAction>
      </CardHeader>
      <CardContent className={`flex flex-col gap-5 ${kept ? "" : "opacity-60"}`}>
        {kinds.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing drawn for this direction yet: draw one from the menu above.
          </p>
        ) : (
          kinds.map((kind) => (
            <KindGroup
              key={kind}
              direction={direction}
              kind={kind}
              onOpen={onOpen}
              action={<DrawAgain direction={direction} kind={kind} />}
              actions={(image) => <ImageActions direction={direction} image={image} />}
            />
          ))
        )}
      </CardContent>
      <CardFooter className="justify-end">
        <KeepToggle title={direction.title} kept={kept} onChange={keep} />
      </CardFooter>
    </Card>
  );
}

/**
 * The inspiration drawn for each kept direction, grouped by kind, to revise,
 * nudge or draw again, and kept or dropped; then the kept ones go on to the
 * mocks, or straight to the screens.
 */
export function InspirationStep() {
  const sketchbook = useCanvas((s) => s.sketchbook?.sketchbook);
  const moveTo = useMoveTo();
  const drawing = useDrawing().images > 0;
  const picked = sketchbook ? activeDirections(sketchbook).filter((d) => d.picked) : [];
  const kept = sketchbook ? mockDirections(sketchbook).length : 0;
  const lightbox = useLightbox(
    picked.flatMap((d) => d.images.filter((i) => isInspirationKind(i.kind))),
  );
  if (!sketchbook) return null;
  return (
    <StepFrame
      title="Inspiration"
      ask={`What each kept direction looks like beyond its words: open any image at full size, nudge it, redraw it in words, or draw another kind. Keep the ones worth taking further (${kept} of ${picked.length} kept): mocks are drawn from these, and the screens are sent them too.`}
      footer={
        <>
          <MockCountPicker />
          <ModelPicker intent="mock" />
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="sm"
            disabled={kept === 0 || drawing}
            onClick={() => moveTo("screens")}
          >
            Skip to screens
          </Button>
          <DrawMocksButton />
        </>
      }
    >
      {picked.length === 0 ? (
        <EmptyState
          title="No direction is kept"
          hint="Keep one on the directions step to draw its inspiration."
          icon={Palette}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {picked.map((d) => (
            <InspirationCard key={d.id} direction={d} onOpen={lightbox.open} />
          ))}
        </div>
      )}
      {lightbox.view}
    </StepFrame>
  );
}
