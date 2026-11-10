import { Copy } from "lucide-react";
import { useEffect } from "react";
import { liveAgentSession } from "../../store/agent.ts";
import { useCanvas } from "../../store.ts";
import { pushToast, toastError } from "../../toast.ts";
import { ProviderLogo } from "../Agent/provider-logo.tsx";
import { Button } from "../ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.tsx";
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "../ui/item.tsx";

/**
 * An agent outside the canvas gets no art direction card with the message, so
 * the copied prompt says where to start.
 */
const ELSEWHERE =
  "Call get_art_direction on the velloo MCP server first: its `next` says what to do, and velloo://guide/art-direction is the whole flow.";

/**
 * Which agent runs the art direction: one click starts it in the Agent tab on
 * `prompt`. The session already open comes first, when there is one. With no
 * agent on this computer, the prompt is offered to copy into one elsewhere;
 * the canvas follows as soon as that agent writes.
 */
export function AgentChoices({
  prompt,
  onStart,
}: {
  prompt: string;
  /** Runs before the agent is started, e.g. to mark the art direction begun. */
  onStart?: (() => Promise<void>) | undefined;
}) {
  const providers = useCanvas((s) => s.agentProviders);
  const sessions = useCanvas((s) => s.agentSessions);
  const activeId = useCanvas((s) => s.agentActiveSessionId);
  const run = useCanvas((s) => s.runArtDirectionAgent);
  const ask = useCanvas((s) => s.askArtDirectionAgent);
  const live = liveAgentSession({ agentSessions: sessions, agentActiveSessionId: activeId });
  const liveSession = sessions.find((s) => s.id === live);

  useEffect(() => {
    if (useCanvas.getState().agentProviders === null) void useCanvas.getState().loadAgent();
  }, []);

  const go = (start: () => Promise<unknown>) =>
    void (async () => {
      try {
        await onStart?.();
        await start();
      } catch (err) {
        toastError(err, "Could not start the agent");
      }
    })();

  const ready = (providers ?? []).filter((p) => p.status === "ready");
  const label = (id: string) => providers?.find((p) => p.id === id)?.label ?? id;

  if (providers !== null && ready.length === 0 && !liveSession) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
        <p>
          No coding agent is installed on this computer. Paste the prompt into the agent you use;
          this page moves on as soon as it writes the brief.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="self-start"
          onClick={() =>
            void navigator.clipboard
              .writeText(`${prompt} ${ELSEWHERE}`)
              .then(() => pushToast({ kind: "success", message: "Prompt copied." }))
              .catch(() => pushToast({ kind: "info", message: "Copy failed." }))
          }
        >
          <Copy />
          Copy the prompt
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5" data-art-direction-agents>
      {liveSession ? (
        <Item asChild variant="outline" size="sm" className="cursor-pointer hover:bg-muted/50">
          <button type="button" onClick={() => go(() => ask(prompt))}>
            <ItemMedia>
              <ProviderLogo provider={liveSession.provider} size={18} />
            </ItemMedia>
            <ItemContent className="text-left">
              <ItemTitle>{label(liveSession.provider)}, in the open session</ItemTitle>
              <ItemDescription>Carries on the conversation you have going.</ItemDescription>
            </ItemContent>
          </button>
        </Item>
      ) : null}
      {ready.map((p) => (
        <Item
          key={p.id}
          asChild
          variant="outline"
          size="sm"
          className="cursor-pointer hover:bg-muted/50"
        >
          <button type="button" onClick={() => go(() => run(p.id, prompt))}>
            <ItemMedia>
              <ProviderLogo provider={p.id} size={18} />
            </ItemMedia>
            <ItemContent className="text-left">
              <ItemTitle>{liveSession ? `A new ${p.label} session` : p.label}</ItemTitle>
              {p.account ? <ItemDescription>{p.account}</ItemDescription> : null}
            </ItemContent>
          </button>
        </Item>
      ))}
      {providers === null ? (
        <p className="text-xs text-muted-foreground">Looking for agents on this computer…</p>
      ) : null}
    </div>
  );
}

/** Asked when the art direction needs an agent and none is open in the Agent tab. */
export function AgentPickerDialog() {
  const prompt = useCanvas((s) => s.artDirectionAsk);
  const cancel = useCanvas((s) => s.cancelArtDirectionAsk);
  return (
    <Dialog open={prompt !== null} onOpenChange={(open) => (open ? null : cancel())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Which agent should do this?</DialogTitle>
          <DialogDescription>
            It starts in the Agent tab, beside the art direction.
          </DialogDescription>
        </DialogHeader>
        {prompt ? <AgentChoices prompt={prompt} /> : null}
      </DialogContent>
    </Dialog>
  );
}
