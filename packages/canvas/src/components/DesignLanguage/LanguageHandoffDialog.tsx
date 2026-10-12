import { Copy } from "lucide-react";
import { type LanguageHandoff, useCanvas } from "../../store.ts";
import { pushToast } from "../../toast.ts";
import { Button } from "../ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.tsx";

/** "colour, type and corners" */
function list(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/**
 * The ask an agent needs to bring existing boards in line. It names the
 * outcome and where the language now lives; how to screenshot and edit is
 * already in the MCP instructions.
 */
function applyLanguagePrompt({ theme, areas, boards }: LanguageHandoff): string {
  const isDefault = theme === "default";
  return [
    isDefault
      ? `The design language of this Velloo design just changed (${list(areas)}). Bring every board that uses the default theme in line with it:`
      : `The "${theme}" theme of this Velloo design just changed (${list(areas)}). Bring the boards that use it in line with it — ${list(boards)}:`,
    `1. Read it first: get_theme${isDefault ? "" : ` { theme: "${theme}" }`}, and the rules in the document it names (designSystem.path).`,
    "2. Go board by board. Screenshot each screen in light and dark, and fix what no longer follows the language — colours, faces or corner radii set by hand instead of through the theme, and anything that breaks a rule.",
    "3. Leave the theme and the rules as they are; they are the source of truth now.",
    "4. Tell me, board by board, what you changed and what you left alone.",
  ].join("\n");
}

/**
 * Shown after a changed theme is kept on a design that has boards using it.
 * The honest position is two-sided: most of the change is already everywhere,
 * because boards read the theme — and the rest needs someone to go and look.
 */
export function LanguageHandoffDialog() {
  const handoff = useCanvas((s) => s.languageHandoff);
  const dismiss = useCanvas((s) => s.dismissLanguageHandoff);
  if (!handoff) return null;
  const prompt = applyLanguagePrompt(handoff);
  const count = handoff.boards.length;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      pushToast({ kind: "success", message: "Prompt copied — paste it to your coding agent." });
    } catch {
      pushToast({ kind: "info", message: "Copy failed — select the prompt text instead." });
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
    >
      <DialogContent data-testid="language-handoff" className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Bring your boards in line</DialogTitle>
          <DialogDescription>
            The change to {list(handoff.areas)} is already on{" "}
            {count === 1 ? "the board" : `the ${count} boards`} that use{count === 1 ? "s" : ""}{" "}
            {handoff.theme === "default" ? "this theme" : handoff.theme}, wherever a design reads
            the theme. What the theme cannot reach — a colour, face or corner set by hand, or a
            layout that now breaks a rule — needs your agent to go and look.
          </DialogDescription>
        </DialogHeader>
        <pre className="whitespace-pre-wrap rounded-md bg-muted/60 p-3 text-xs leading-relaxed font-mono">
          {prompt}
        </pre>
        <DialogFooter>
          <Button variant="ghost" onClick={dismiss}>
            Not now
          </Button>
          <Button onClick={() => void copy()}>
            <Copy />
            Copy prompt for your agent
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
