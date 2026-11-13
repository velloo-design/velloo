import type { ImageModel } from "@velloo/protocol";
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
export function useTakesPrompt(intent: "moodboard" | "mock", model: ImageModel | undefined) {
  const chars = useCanvas((s) => s.artDirection?.promptChars[intent] ?? 0);
  return !model?.maxPromptChars || chars <= model.maxPromptChars;
}

/** The model a draw will run on: the picked one, else the cloud's default for the kind. */
export function useModel(intent: "moodboard" | "mock"): ImageModel | undefined {
  const models = useCanvas((s) => s.artDirectionModels);
  const picked = useCanvas((s) => s.artDirection?.artDirection.models[intent]);
  const id = picked ?? models?.defaults[intent];
  return models?.models.find((m) => m.id === id);
}

/**
 * Which image model draws the mood boards or the mocks. Velloo's own starter
 * models first; a pro model is listed but unavailable until the account has
 * bought credits, which is said rather than hidden, since it is the reason to.
 */
export function ModelPicker({ intent }: { intent: "moodboard" | "mock" }) {
  const models = useCanvas((s) => s.artDirectionModels);
  const problem = useCanvas((s) => s.artDirectionModelsProblem);
  const update = useCanvas((s) => s.updateArtDirection);
  const openSignIn = useCanvas((s) => s.openSignIn);
  const signedOut = useCanvas((s) => s.artDirectionSignedOut);
  const current = useModel(intent);
  const chars = useCanvas((s) => s.artDirection?.promptChars[intent] ?? 0);
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
        aria-label={intent === "moodboard" ? "Mood board model" : "Mock model"}
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
