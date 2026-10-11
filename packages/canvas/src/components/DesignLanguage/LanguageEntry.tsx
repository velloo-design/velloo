import { Copy, Plus, ScanSearch, SwatchBook } from "lucide-react";
import { useEffect, useRef } from "react";
import { useCanvas } from "../../store.ts";
import { pushToast, toastError } from "../../toast.ts";
import { Button } from "../ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card.tsx";
import { PROPOSE_LANGUAGE_PROMPT } from "./agent-prompt.ts";
import { readLanguageSet } from "./language-set.ts";

interface Props {
  /** The plain way out: one empty board, as before. */
  onNewBoard: () => void;
}

const FIRST_SCREEN_PROMPT =
  "Use Velloo to design a first screen for this app, following the design language already set on this design (get_theme, and the rules in the document it names).";

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    pushToast({ kind: "success", message: "Prompt copied — paste it to your coding agent." });
  } catch {
    pushToast({ kind: "info", message: "Copy failed — select the prompt text instead." });
  }
}

/**
 * What a design with no boards opens to. Before a language exists it offers
 * the two ways to get one: an agent reads the app and proposes it, or the
 * person defines it here. Once one exists, it says so and points at what comes
 * next, rather than offering to start over.
 */
export function LanguageEntry({ onNewBoard }: Props) {
  const openLanguage = useCanvas((s) => s.openLanguage);
  const rules = useCanvas((s) => s.languageRules);
  const folderId = useCanvas((s) => s.design?.folderId);
  const stated = Boolean(rules?.source);
  const isSet = stated || readLanguageSet(folderId);

  // "Read it from my app" hands the agent a prompt and waits. Rules appearing
  // while this screen is up is that proposal landing, so open it for review.
  const before = useRef<boolean | null>(null);
  useEffect(() => {
    if (rules === null) return;
    if (before.current === false && stated) {
      void openLanguage("review").catch((err) => toastError(err, "Could not open the proposal"));
    }
    before.current = stated;
  }, [rules, stated, openLanguage]);

  const open = (mode: "guided" | "review") =>
    void openLanguage(mode).catch((err) => toastError(err, "Could not open the design language"));

  if (isSet) {
    return (
      <div className="flex-1 overflow-y-auto grid place-items-center p-10">
        <div className="w-full max-w-xl flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">Your design language is set</h1>
            <p className="text-sm text-muted-foreground">
              Every design here follows it. Start a board, or have your agent design a first screen
              with it.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={onNewBoard}>
              <Plus />
              New board
            </Button>
            <Button variant="outline" size="sm" onClick={() => void copy(FIRST_SCREEN_PROMPT)}>
              <Copy />
              Copy a prompt for a first screen
            </Button>
            <Button variant="ghost" size="sm" onClick={() => open("review")}>
              <SwatchBook />
              Review the design language
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto grid place-items-center p-10">
      <div className="w-full max-w-3xl flex flex-col gap-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Start with a design language</h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            Colour, type, shape and a few rules in plain words — set once, shown on this design's
            real components, and followed by every design after it.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <ScanSearch className="size-5 text-primary" />
              <CardTitle>Read it from my app</CardTitle>
              <CardDescription>
                Your coding agent reads the app's styles, fonts and components and proposes a
                language. You review it here.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <pre className="whitespace-pre-wrap rounded-md bg-muted/60 p-3 text-xs leading-relaxed font-mono">
                {PROPOSE_LANGUAGE_PROMPT}
              </pre>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void copy(PROPOSE_LANGUAGE_PROMPT)}
              >
                <Copy />
                Copy prompt for your agent
              </Button>
              <p className="text-xs text-muted-foreground">
                This page opens the proposal on its own when it lands.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <SwatchBook className="size-5 text-primary" />
              <CardTitle>Define it here</CardTitle>
              <CardDescription>
                No app to match, or you want a new direction. Four short steps — colour, type,
                shape, rules — on live components. No agent needed.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button size="sm" onClick={() => open("guided")}>
                Start
              </Button>
            </CardContent>
          </Card>
        </div>
        <div>
          <Button variant="ghost" size="sm" onClick={onNewBoard}>
            <Plus />
            Or start with an empty board
          </Button>
        </div>
      </div>
    </div>
  );
}
