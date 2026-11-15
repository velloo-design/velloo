import {
  type IntentPrice,
  kindLabel,
  MOCK_KINDS,
  SKETCHBOOK_LIMITS,
  TOP_INSPIRATION_KINDS,
} from "@velloo/protocol";
import { activeDirections, latestOf, type SketchbookDirection } from "@velloo/schema";
import { ChevronDown, ImagePlus, Lock, Palette } from "lucide-react";
import { useState } from "react";
import { useCanvas } from "../../store.ts";
import { toastError } from "../../toast.ts";
import { Credits } from "../Credits.tsx";
import { Button } from "../ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.tsx";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group.tsx";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group.tsx";
import { ModelPicker, useKinds, useModelOf } from "./ModelPicker.tsx";
import { useDraw, useMoveTo } from "./stage-parts.tsx";

/** The cloud draws a custom image on its imagery intent when it has none of its own for it. */
const CUSTOM_INTENT = ["custom", "imagery"];

/** The picked directions that still need an image of `kind` (a custom one: of these words). */
function needing(picked: SketchbookDirection[], kind: string, ask: string): SketchbookDirection[] {
  if (kind === "custom") {
    return picked.filter((d) => !d.images.some((i) => i.kind === "custom" && i.ask === ask));
  }
  return picked.filter((d) => !latestOf(d, kind));
}

/**
 * The directions step's footer: which inspiration to draw for the kept
 * directions (the subject's three top kinds as toggles, the cloud's other
 * kinds under More, and an image in the person's own words), drawn with one
 * button; or skip straight on to the mocks or the screens.
 */
export function InspirationPicker() {
  const sketchbook = useCanvas((s) => s.sketchbook?.sketchbook);
  const models = useCanvas((s) => s.sketchbookModels);
  const update = useCanvas((s) => s.updateSketchbook);
  const offered = useKinds();
  const modelOf = useModelOf();
  const draw = useDraw();
  const moveTo = useMoveTo();
  const subject = sketchbook?.subject ?? "page";
  const intents = offered.map((k) => k.intent);
  const top: string[] = TOP_INSPIRATION_KINDS[subject].filter((k) => intents.includes(k));
  const more = offered.filter(
    (k) => !top.includes(k.intent) && !MOCK_KINDS.includes(k.intent) && k.intent !== "custom",
  );
  const customOffered = CUSTOM_INTENT.some((k) => intents.includes(k));
  const saved = sketchbook?.inspiration;
  // Until the person picks, the subject's first kind is: the kinds may still be loading.
  const [picks, setKinds] = useState<string[] | null>(() => {
    const kept = (saved?.kinds ?? []).filter((k) => k !== "custom");
    return kept.length > 0 ? kept : null;
  });
  const kinds = picks ?? top.slice(0, 1);
  const [custom, setCustom] = useState(saved?.custom ?? "");
  if (!sketchbook) return null;

  const picked = activeDirections(sketchbook).filter((d) => d.picked);
  const chosenKinds = kinds.filter((k) => intents.includes(k));
  const ask = customOffered ? custom.trim() : "";
  const modelFor = (kind: string) =>
    kind === "custom" ? (modelOf("custom") ?? modelOf("imagery")) : modelOf(kind);
  const locked = (k: IntentPrice) => Boolean(k.locked || modelFor(k.intent)?.locked);
  const draws = [
    ...chosenKinds.map((kind) => ({ kind, directions: needing(picked, kind, "") })),
    ...(ask ? [{ kind: "custom", directions: needing(picked, "custom", ask) }] : []),
  ].filter((d) => d.directions.length > 0);
  const images = draws.reduce((n, d) => n + d.directions.length, 0);
  const price = draws.reduce(
    (n, d) => n + (modelFor(d.kind)?.priceMicros ?? 0) * d.directions.length,
    0,
  );
  const selected = chosenKinds.length > 0 || ask.length > 0;
  const toggle = (kind: string, on: boolean) =>
    setKinds(on ? [...new Set([...kinds, kind])] : kinds.filter((k) => k !== kind));
  const fromMore = more.filter((k) => chosenKinds.includes(k.intent)).length;

  const go = async () => {
    try {
      await update({ inspiration: { kinds: chosenKinds, custom: ask } });
    } catch (err) {
      toastError(err, "Could not save the inspiration");
      return;
    }
    for (const d of draws) {
      const noun = `${kindLabel(d.kind, offered).toLowerCase()}s`;
      draw(
        {
          kind: d.kind,
          directions: d.directions.map((x) => x.id),
          ...(d.kind === "custom" ? { ask } : {}),
        },
        noun,
      );
    }
    moveTo("inspiration");
  };

  return (
    <div className="flex w-full flex-col gap-3" data-inspiration-picker>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">
          Inspiration for {picked.length} kept {picked.length === 1 ? "direction" : "directions"}
        </span>
        {top.length > 0 ? (
          <ToggleGroup
            type="multiple"
            variant="outline"
            size="sm"
            spacing={0}
            aria-label="Inspiration to draw"
            value={chosenKinds.filter((k) => top.includes(k))}
            onValueChange={(v: string[]) =>
              setKinds([...v, ...kinds.filter((k) => !top.includes(k))])
            }
          >
            {top.map((kind) => {
              const k = offered.find((o) => o.intent === kind);
              return (
                <ToggleGroupItem
                  key={kind}
                  value={kind}
                  className="text-xs"
                  disabled={k ? locked(k) : false}
                  title={k?.summary}
                >
                  {k && locked(k) ? <Lock aria-label="Add credits to unlock" /> : null}
                  {kindLabel(kind, offered)}
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
        ) : null}
        {more.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                More{fromMore > 0 ? ` · ${fromMore}` : ""}
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-60">
              <DropdownMenuLabel>Also draw</DropdownMenuLabel>
              {more.map((k) => {
                const model = modelFor(k.intent);
                const off = locked(k);
                return (
                  <DropdownMenuCheckboxItem
                    key={k.intent}
                    checked={chosenKinds.includes(k.intent)}
                    disabled={off}
                    title={k.summary}
                    onSelect={(e) => e.preventDefault()}
                    onCheckedChange={(on) => toggle(k.intent, on === true)}
                  >
                    <span className="flex-1">{kindLabel(k.intent, offered)}</span>
                    {off ? (
                      <Lock aria-label="Add credits to unlock" />
                    ) : (
                      <Credits
                        micros={model?.priceMicros ?? k.priceMicros}
                        className="text-xs text-muted-foreground"
                      />
                    )}
                  </DropdownMenuCheckboxItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {customOffered ? (
          <InputGroup className="h-8 min-w-56 flex-1">
            <InputGroupAddon>
              <ImagePlus />
            </InputGroupAddon>
            <InputGroupInput
              aria-label="A custom image"
              placeholder="Or describe an image: the product on a desk at night"
              maxLength={SKETCHBOOK_LIMITS.ask}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
            />
          </InputGroup>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          disabled={picked.length === 0}
          onClick={() => moveTo("screens")}
        >
          Skip to screens
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={picked.length === 0}
          onClick={() => moveTo("mocks")}
        >
          Skip to mocks
        </Button>
        {models ? (
          <Button size="sm" disabled={picked.length === 0 || !selected} onClick={() => void go()}>
            <Palette />
            {picked.length === 0 ? (
              "Keep a direction to continue"
            ) : !selected ? (
              "Pick what to draw"
            ) : images === 0 ? (
              "Show the inspiration"
            ) : (
              <>
                Draw inspiration · {images} {images === 1 ? "image" : "images"}
                {price > 0 ? (
                  <>
                    {" · "}
                    <Credits micros={price} />
                  </>
                ) : null}
              </>
            )}
          </Button>
        ) : (
          <ModelPicker intent={top[0] ?? "moodboard"} />
        )}
      </div>
    </div>
  );
}
