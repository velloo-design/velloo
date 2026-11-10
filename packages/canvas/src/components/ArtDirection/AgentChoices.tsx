import type { AgentModelOption } from "@velloo/protocol/agent";
import { ChevronDown, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { agent } from "../../api/agent.ts";
import { liveAgentSession } from "../../store/agent.ts";
import type { AgentStart } from "../../store/art-direction.ts";
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
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "../ui/item.tsx";
import { NativeSelect, NativeSelectOption } from "../ui/native-select.tsx";
import { Spinner } from "../ui/spinner.tsx";

/**
 * An agent outside the canvas gets no art direction card with the message, so
 * the copied prompt says where to start.
 */
const ELSEWHERE =
  "Call get_art_direction on the velloo MCP server first: its `next` says what to do, and velloo://guide/art-direction is the whole flow.";

/** The agents whose model can be read before the first message. */
const MODEL_PICKERS = new Set(["claude-code", "codex"]);

/** How long an agent may take to say which models it has. */
const MODELS_TIMEOUT_MS = 20_000;

type Prepared =
  | { state: "loading" }
  | { state: "ready"; session: string; models: AgentModelOption[]; model: string | undefined };

/**
 * Which agent runs the art direction: one click starts it in the Agent tab.
 * The session already open comes first, when there is one. Claude Code and
 * Codex offer their model, quietly: reading it means starting the agent, so
 * that happens only when asked, and the session it starts is the one used.
 * With no agent on this computer, the prompt is offered to copy into one
 * elsewhere; the canvas follows as soon as that agent writes.
 */
export function AgentChoices({
  prompt,
  onPick,
}: {
  prompt: string;
  /** Null is the session already open. */
  onPick: (start: AgentStart | null) => Promise<void>;
}) {
  const providers = useCanvas((s) => s.agentProviders);
  const sessions = useCanvas((s) => s.agentSessions);
  const activeId = useCanvas((s) => s.agentActiveSessionId);
  const live = liveAgentSession({ agentSessions: sessions, agentActiveSessionId: activeId });
  const liveSession = sessions.find((s) => s.id === live);
  const [prepared, setPrepared] = useState<Record<string, Prepared>>({});
  // Sessions started to read a model and then not used are stopped on the way out.
  const unused = useRef(new Set<string>());

  useEffect(() => {
    if (useCanvas.getState().agentProviders === null) void useCanvas.getState().loadAgent();
    const left = unused.current;
    return () => {
      for (const id of left) {
        void agent
          .stop(id)
          .catch(() => {})
          .then(() => agent.remove(id))
          .catch(() => {});
      }
    };
  }, []);

  const go = (start: AgentStart | null) =>
    void (async () => {
      if (start?.session) unused.current.delete(start.session);
      try {
        await onPick(start);
      } catch (err) {
        toastError(err, "Could not start the agent");
      }
    })();

  const readModels = async (provider: string) => {
    setPrepared((p) => ({ ...p, [provider]: { state: "loading" } }));
    try {
      const { session } = await agent.start({ provider });
      unused.current.add(session.id);
      const deadline = Date.now() + MODELS_TIMEOUT_MS;
      let controls: Awaited<ReturnType<typeof agent.snapshot>>["controls"];
      while (!controls && Date.now() < deadline) {
        controls = (await agent.snapshot(session.id)).controls;
        if (!controls) await new Promise((r) => setTimeout(r, 300));
      }
      setPrepared((p) => ({
        ...p,
        [provider]: {
          state: "ready",
          session: session.id,
          models: controls?.models ?? [],
          model: controls?.model,
        },
      }));
    } catch (err) {
      setPrepared(({ [provider]: _gone, ...rest }) => rest);
      toastError(err, "Could not read the agent's models");
    }
  };

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
          <button type="button" onClick={() => go(null)}>
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
      {ready.map((p) => {
        const prep = prepared[p.id];
        const start: AgentStart =
          prep?.state === "ready"
            ? { provider: p.id, session: prep.session, model: prep.model }
            : { provider: p.id };
        return (
          <Item key={p.id} variant="outline" size="sm" className="hover:bg-muted/50">
            <button
              type="button"
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              disabled={prep?.state === "loading"}
              onClick={() => go(start)}
              data-agent-choice={p.id}
            >
              <ItemMedia>
                <ProviderLogo provider={p.id} size={18} />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{liveSession ? `A new ${p.label} session` : p.label}</ItemTitle>
                {p.account ? <ItemDescription>{p.account}</ItemDescription> : null}
              </ItemContent>
            </button>
            {MODEL_PICKERS.has(p.id) ? (
              <ItemActions>
                {prep === undefined ? (
                  <Button
                    variant="ghost"
                    size="xs"
                    className="text-muted-foreground"
                    onClick={() => void readModels(p.id)}
                  >
                    Default model
                    <ChevronDown />
                  </Button>
                ) : prep.state === "loading" ? (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Spinner className="size-3" /> Asking {p.label}…
                  </span>
                ) : prep.models.length > 0 ? (
                  <NativeSelect
                    size="sm"
                    aria-label={`${p.label} model`}
                    value={prep.model ?? ""}
                    onChange={(e) =>
                      setPrepared((all) => ({
                        ...all,
                        [p.id]: { ...prep, model: e.target.value || undefined },
                      }))
                    }
                  >
                    {prep.model ? null : <NativeSelectOption value="">Default</NativeSelectOption>}
                    {prep.models.map((m) => (
                      <NativeSelectOption key={m.id} value={m.id}>
                        {m.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                ) : (
                  <span className="text-xs text-muted-foreground">Picks its own model</span>
                )}
              </ItemActions>
            ) : null}
          </Item>
        );
      })}
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
  const run = useCanvas((s) => s.runArtDirectionAgent);
  const ask = useCanvas((s) => s.askArtDirectionAgent);
  return (
    <Dialog open={prompt !== null} onOpenChange={(open) => (open ? null : cancel())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Which agent should do this?</DialogTitle>
          <DialogDescription>
            It starts in the Agent tab, beside the art direction.
          </DialogDescription>
        </DialogHeader>
        {prompt ? (
          <AgentChoices
            prompt={prompt}
            onPick={async (start) => {
              if (start) await run(start, prompt);
              else await ask(prompt);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
