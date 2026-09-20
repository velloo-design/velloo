import { ChevronRight, Copy } from "lucide-react";
import { useState } from "react";
import type { RepoCatalogEntry, RepoDiagnostic } from "../api.ts";
import { pushToast } from "../toast.ts";
import { Button } from "./ui/button.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible.tsx";

/**
 * What to do about a component that doesn't render. The fix is an agent's to
 * make — a preview entry supplying the providers and stylesheet the app's own
 * entry gives its components — so this hands over the ask rather than
 * describing it: the prompt is written for the agent, and copied in one click.
 */
export function RepoPreviewHelp({
  entry,
  diagnostic,
  previewLabel,
}: {
  entry: RepoCatalogEntry;
  diagnostic: RepoDiagnostic;
  previewLabel: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const prompt = promptFor(entry, diagnostic, previewLabel);
  return (
    <div className="rounded-md border border-dashed px-4 py-3 flex flex-col gap-2">
      <p className="text-sm">
        Your agent can fix this: ask it to set up the design's{" "}
        <span className="font-medium">preview entry</span> — the file that gives the canvas the
        providers and styles your app's own entry gives its components.
      </p>
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex items-center gap-2">
          <CollapsibleTrigger asChild>
            <Button size="xs" variant="ghost" className="px-1.5 -ml-1.5">
              <ChevronRight className={`transition-transform ${open ? "rotate-90" : ""}`} />
              {open ? "Hide the prompt" : "See the prompt"}
            </Button>
          </CollapsibleTrigger>
          <Button size="xs" variant="outline" onClick={() => void copy(prompt)}>
            <Copy />
            Copy prompt
          </Button>
        </div>
        <CollapsibleContent>
          <pre className="mt-2 whitespace-pre-wrap rounded-md bg-muted/60 p-3 text-xs leading-relaxed font-mono">
            {prompt}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    pushToast({ kind: "success", message: "Prompt copied." });
  } catch {
    pushToast({ kind: "info", message: "Copy failed — select the prompt text instead." });
  }
}

/** The ask, in the agent's own vocabulary: the tools, the symptom, the check. */
function promptFor(
  entry: RepoCatalogEntry,
  diagnostic: RepoDiagnostic,
  previewLabel: string | undefined,
): string {
  const symptom = [diagnostic.note, diagnostic.remedy].filter(Boolean).join(" ");
  const reads = (entry.dataSources ?? []).map((hook) => hook.name).join(", ");
  return [
    `In Velloo, ${entry.id} (from ${entry.identity.importPath}) doesn't render on the canvas:`,
    `${diagnostic.status}${diagnostic.code ? ` (${diagnostic.code})` : ""}. ${symptom}`.trim(),
    "",
    previewLabel
      ? `The design's preview entry is currently: ${previewLabel}.`
      : "The design has no preview entry yet.",
    "",
    ...(reads
      ? [`It reads its own data through ${reads}, so the preview has to supply that too.`, ""]
      : []),
    "Please run preview_status to see what the app's components need, then write the",
    "preview entry with set_preview_entry: import the app's global stylesheet and wrap",
    "children in the providers the app's own entry uses (theme, i18n, query client, …),",
    "with fixtures instead of network calls. Re-run preview_status, and check",
    `component_status for ${entry.id} to confirm it renders.`,
  ].join("\n");
}
