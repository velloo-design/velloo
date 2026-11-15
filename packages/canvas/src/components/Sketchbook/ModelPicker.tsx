import {
  type ImageModel,
  type IntentPrice,
  kindLabel,
  SKETCHBOOK_KIND_LABELS,
} from "@velloo/protocol";
import { LogIn } from "lucide-react";
import { useCanvas } from "../../store.ts";
import { Credits } from "../Credits.tsx";
import { Button } from "../ui/button.tsx";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "../ui/select.tsx";

/** Whether `model` takes the longest prompt this kind of image would be sent with. */
export function useTakesPrompt(intent: string, model: ImageModel | undefined) {
  const chars = useCanvas((s) => s.sketchbook?.promptChars[intent] ?? 0);
  return !model?.maxPromptChars || chars <= model.maxPromptChars;
}

/** The model a draw will run on: the picked one, else the cloud's default for the kind. */
export function useModel(intent: string): ImageModel | undefined {
  return useModelOf()(intent);
}

/** `useModel` for several kinds at once: the model each would be drawn on. */
export function useModelOf(): (intent: string) => ImageModel | undefined {
  const models = useCanvas((s) => s.sketchbookModels);
  const picks = useCanvas((s) => s.sketchbook?.sketchbook.models);
  return (intent) => {
    const id = picks?.[intent] ?? models?.defaults[intent];
    return models?.models.find((m) => m.id === id);
  };
}

/** The kinds of image the cloud draws, and what each is called. */
export function useKinds(): IntentPrice[] {
  return useCanvas((s) => s.sketchbookKinds);
}

/** Why a kind Velloo knows is shown but can't be picked. */
export const NOT_ON_CLOUD = "Your Velloo cloud doesn't draw this yet";

/** A kind Velloo can draw, with the cloud's offer for it; none when the cloud doesn't list it. */
export interface KindChoice {
  intent: string;
  offer: IntentPrice | undefined;
}

/**
 * Every kind Velloo has a name for, the cloud's first in its order, then the
 * ones it doesn't list yet: those are shown, unavailable, rather than hidden,
 * so a cloud that lags Velloo says so instead of looking like a short menu.
 */
export function useKindChoices(): KindChoice[] {
  const offered = useKinds();
  const listed = new Set(offered.map((k) => k.intent));
  return [
    ...offered.map((k) => ({ intent: k.intent, offer: k })),
    ...Object.keys(SKETCHBOOK_KIND_LABELS)
      .filter((k) => !listed.has(k))
      .map((intent) => ({ intent, offer: undefined })),
  ];
}

/** What a kind is called: the cloud's label, else Velloo's own. */
export function useKindLabel(kind: string): string {
  const kinds = useKinds();
  return kindLabel(kind, kinds);
}

/**
 * Which image model draws the mood boards or the mocks. Velloo's own starter
 * models first; a pro model is listed but unavailable until the account has
 * bought credits, which is said rather than hidden, since it is the reason to.
 */
export function ModelPicker({ intent }: { intent: string }) {
  const models = useCanvas((s) => s.sketchbookModels);
  const problem = useCanvas((s) => s.sketchbookModelsProblem);
  const update = useCanvas((s) => s.updateSketchbook);
  const openSignIn = useCanvas((s) => s.openSignIn);
  const signedOut = useCanvas((s) => s.sketchbookSignedOut);
  const current = useModel(intent);
  const label = useKindLabel(intent);
  const chars = useCanvas((s) => s.sketchbook?.promptChars[intent] ?? 0);
  // A model that takes fewer characters than the page's copy needs is shown,
  // and why it can't be picked said, rather than refused mid-draw.
  const short = (m: ImageModel) => Boolean(m.maxPromptChars && chars > m.maxPromptChars);
  const suffix = (m: ImageModel) => (short(m) ? " · the copy is too long for it" : "");

  if (!models && !signedOut) {
    return (
      <span className="text-xs text-muted-foreground" title={problem ?? undefined}>
        {problem ?? "Image models are unavailable."}
      </span>
    );
  }
  if (!models) {
    return (
      <Button variant="outline" size="sm" onClick={() => openSignIn()} title={problem ?? undefined}>
        <LogIn />
        Sign in to draw images
      </Button>
    );
  }
  const list = models.models.filter((m) => m.intents.includes(intent));
  const starter = list.filter((m) => m.tier === "starter");
  const pro = list.filter((m) => m.tier === "pro");
  // Radix rather than a native select: an <option> holds text only, and a
  // price is the coins mark and a number.
  const item = (m: ImageModel, disabled: boolean) => (
    <SelectItem key={m.id} value={m.id} disabled={disabled}>
      {m.label} · <Credits micros={m.priceMicros} />
      {suffix(m)}
    </SelectItem>
  );
  return (
    <Select
      value={current?.id ?? ""}
      onValueChange={(id) => void update({ models: { [intent]: id } })}
    >
      <SelectTrigger
        size="sm"
        className="text-xs"
        aria-label={intent === "mock" ? "Mock model" : `${label} model`}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Velloo</SelectLabel>
          {starter.map((m) => item(m, short(m)))}
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>
            {models.unlocked ? "Pro models" : "Pro models: add credits to unlock"}
          </SelectLabel>
          {pro.map((m) => item(m, m.locked || short(m)))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
