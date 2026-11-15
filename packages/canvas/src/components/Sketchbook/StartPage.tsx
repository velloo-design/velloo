import { SKETCHBOOK_LIMITS } from "@velloo/protocol";
import type { SketchbookPage, SketchbookSubject } from "@velloo/schema";
import { ChevronLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { useCanvas } from "../../store.ts";
import { toastError } from "../../toast.ts";
import { Button } from "../ui/button.tsx";
import { Field, FieldDescription, FieldLabel } from "../ui/field.tsx";
import { Textarea } from "../ui/textarea.tsx";
import { AgentChoices } from "./AgentChoices.tsx";
import { ChoiceCards } from "./ChoiceCards.tsx";
import { flowTitle } from "./flows.tsx";
import { PagePicker, useHasApp } from "./PagePicker.tsx";
import { startPrompt } from "./prompts.ts";
import { type DraftReference, DraftReferences, draftPatches } from "./References.tsx";
import { SketchbookMark } from "./SketchbookMark.tsx";

type Origin = "existing" | "new";

const WORDS: Record<
  SketchbookSubject,
  {
    intro: string;
    origins: Record<Origin, { title: string; body: string }>;
    goal: string;
    placeholder: string;
  }
> = {
  page: {
    intro:
      "Your agent writes a brief and three directions, each with its colours and type. You narrow them down while image models draw inspiration and full-page mocks you can revise in words. The ones you choose inspire the screens your agent designs, with your components and your design's rules.",
    origins: {
      existing: {
        title: "Redesign a page of this app",
        body: "Your agent reads the page from the code, so every mock carries its real copy.",
      },
      new: {
        title: "Start something new",
        body: "Your agent asks what you're building, a few questions at a time, and writes the brief from your answers.",
      },
    },
    goal: "What should the page do better?",
    placeholder:
      "Make the pricing page feel calmer and more premium, and make the plans easier to compare.",
  },
  look: {
    intro:
      "Your agent proposes three directions, each a palette and a type pairing, in light and dark. You keep the ones you like, see them drawn as inspiration and mocks, and keep one as a Look your screens are designed with.",
    origins: {
      existing: {
        title: "A look for this app",
        body: "Your agent reads the app's theme and pages, and proposes where to take them.",
      },
      new: {
        title: "A look for something new",
        body: "Your agent asks what you're building and who it's for, then proposes looks for it.",
      },
    },
    goal: "What should it feel like?",
    placeholder: "Warm and editorial, like a print magazine, but still easy to read on a phone.",
  },
};

/**
 * Where a sketchbook starts: what the person wants (an app's page or something
 * new, the goal in their words), what they'd like it to feel like, and the
 * agent that runs it. Nothing is created until they pick the agent.
 */
export function StartPage({ subject }: { subject: SketchbookSubject }) {
  const begin = useCanvas((s) => s.beginSketchbook);
  const home = useCanvas((s) => s.openSketchbook);
  const [origin, setOrigin] = useState<Origin>("existing");
  const [page, setPage] = useState<SketchbookPage | null>(null);
  const [goal, setGoal] = useState("");
  const [references, setReferences] = useState<DraftReference[]>([]);
  const hasApp = useHasApp();
  // A design with no app has nothing of its own to start from.
  useEffect(() => {
    if (hasApp === false) setOrigin("new");
  }, [hasApp]);
  const words = WORDS[subject];
  const text = startPrompt(subject, origin, goal);
  const forPage = subject === "page" && origin === "existing";
  return (
    <div className="flex-1 overflow-y-auto p-10" data-sketchbook-start={subject}>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 self-start text-muted-foreground"
          onClick={() =>
            void home(null).catch((err) => toastError(err, "Could not open the sketchbook"))
          }
        >
          <ChevronLeft />
          Sketchbook
        </Button>
        <div className="flex flex-col gap-3">
          <SketchbookMark className="size-10" />
          <h1 className="text-2xl font-semibold tracking-tight">{flowTitle(subject)}</h1>
          <p className="text-sm text-muted-foreground">{words.intro}</p>
        </div>
        <ChoiceCards
          label="What it's for"
          className="grid gap-3 sm:grid-cols-2"
          value={origin}
          options={(["existing", "new"] as const).map((value) => ({
            value,
            ...words.origins[value],
          }))}
          onChange={setOrigin}
        />
        {forPage ? <PagePicker onChange={setPage} /> : null}
        <Field>
          <FieldLabel htmlFor="sketchbook-goal">{words.goal}</FieldLabel>
          <Textarea
            id="sketchbook-goal"
            rows={3}
            maxLength={SKETCHBOOK_LIMITS.product}
            placeholder={words.placeholder}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
          />
          <FieldDescription>
            In your own words; leave it empty and your agent asks.
          </FieldDescription>
        </Field>
        <DraftReferences value={references} onChange={setReferences} />
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Run it with</h2>
          <AgentChoices
            prompt={text}
            onPick={(start) =>
              begin(
                { subject, origin, page: forPage ? page : null },
                text,
                start,
                draftPatches(references),
              )
            }
          />
        </div>
      </div>
    </div>
  );
}
