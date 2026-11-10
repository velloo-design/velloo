import type { ImageModel } from "@velloo/protocol";
import { LogIn } from "lucide-react";
import { useCanvas } from "../../store.ts";
import { Button } from "../ui/button.tsx";
import { NativeSelect, NativeSelectOption } from "../ui/native-select.tsx";

export const dollars = (micros: number): string => {
  const v = micros / 1_000_000;
  return v < 0.1 ? `$${v.toFixed(2)}` : `$${v.toFixed(2).replace(/0$/, "")}`;
};

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
  return (
    <NativeSelect
      size="sm"
      aria-label={intent === "moodboard" ? "Mood board model" : "Mock model"}
      value={current?.id ?? ""}
      onChange={(e) => void update({ models: { [intent]: e.target.value } })}
    >
      <optgroup label="Velloo">
        {starter.map((m) => (
          <NativeSelectOption key={m.id} value={m.id}>
            {m.label} · {dollars(m.priceMicros)}
          </NativeSelectOption>
        ))}
      </optgroup>
      <optgroup label={models.unlocked ? "Pro models" : "Pro models: add credits to unlock"}>
        {pro.map((m) => (
          <NativeSelectOption key={m.id} value={m.id} disabled={m.locked}>
            {m.label} · {dollars(m.priceMicros)}
          </NativeSelectOption>
        ))}
      </optgroup>
    </NativeSelect>
  );
}
