import { Copy, Plus, ScanSearch, SwatchBook } from "lucide-react";
import { useCanvas } from "../../store.ts";
import { pushToast, toastError } from "../../toast.ts";
import { Button } from "../ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card.tsx";
import { PROPOSE_LANGUAGE_PROMPT } from "./agent-prompt.ts";

interface Props {
  /** The plain way out: one empty board, as before. */
  onNewBoard: () => void;
}

/**
 * What a design with nothing on it opens to. Both ways in end with the same
 * board on the canvas: an agent reads the app and proposes a language, or the
 * person starts one here. Neither leaves an empty board behind.
 */
export function LanguageEntry({ onNewBoard }: Props) {
  const openLanguage = useCanvas((s) => s.openLanguage);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(PROPOSE_LANGUAGE_PROMPT);
      pushToast({ kind: "success", message: "Prompt copied — paste it to your coding agent." });
    } catch {
      pushToast({ kind: "info", message: "Copy failed — select the prompt text instead." });
    }
  };

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
              <Button variant="outline" size="sm" onClick={() => void copy()}>
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
              <CardTitle>Start fresh</CardTitle>
              <CardDescription>
                No app to match, or you want a new direction. Pick a starting point and shape it on
                live components. No agent needed.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                size="sm"
                onClick={() =>
                  void openLanguage().catch((err) =>
                    toastError(err, "Could not open the design language"),
                  )
                }
              >
                Define it here
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
