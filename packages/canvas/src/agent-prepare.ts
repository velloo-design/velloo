import type { AgentModelOption } from "@velloo/protocol/agent";
import { useEffect, useRef, useState } from "react";
import { agent } from "./api/agent.ts";
import type { AgentLaunch } from "./store/agent.ts";
import { useCanvas } from "./store.ts";
import { toastError } from "./toast.ts";

/** The agents whose model can be read before the first message. */
export const MODEL_PICKERS = new Set(["claude-code", "codex"]);

/** How long an agent may take to say which models it has. */
const MODELS_TIMEOUT_MS = 20_000;

/** An agent asked for its models ahead of a start: still asking, or the answer. */
export type PreparedModels =
  | { state: "loading" }
  | { state: "ready"; session: string; models: AgentModelOption[]; model: string | undefined };

/** Stop and forget the sessions started ahead and not picked. */
function discard(sessions: Set<string>) {
  const gone = [...sessions];
  sessions.clear();
  if (gone.length === 0) return;
  useCanvas.setState((s) => ({
    agentPreparing: s.agentPreparing.filter((id) => !gone.includes(id)),
  }));
  for (const id of gone) {
    void agent
      .stop(id)
      .catch(() => {})
      .then(() => agent.remove(id))
      .catch(() => {});
  }
}

/**
 * Offering an agent's model before its first message means starting it, so
 * that happens only when asked, the session started is the one used if the
 * agent is picked, and the rest are stopped once the picker goes away.
 */
export function usePreparedAgents() {
  const [prepared, setPrepared] = useState<Record<string, PreparedModels>>({});
  const unused = useRef(new Set<string>());

  useEffect(() => {
    const left = unused.current;
    return () => discard(left);
  }, []);

  const read = async (provider: string) => {
    setPrepared((p) => ({ ...p, [provider]: { state: "loading" } }));
    try {
      const { session } = await agent.start({ provider });
      unused.current.add(session.id);
      useCanvas.setState((s) => ({ agentPreparing: [...s.agentPreparing, session.id] }));
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

  const pick = (provider: string, model: string | undefined) =>
    setPrepared((all) => {
      const prep = all[provider];
      return prep?.state === "ready" ? { ...all, [provider]: { ...prep, model } } : all;
    });

  /** How to start `provider`: on the session read ahead and the model picked, when there is one. */
  const launch = (provider: string): AgentLaunch => {
    const prep = prepared[provider];
    const kept = prep?.state === "ready" ? prep : undefined;
    if (kept) unused.current.delete(kept.session);
    // Any others were read for this choice, which is made.
    discard(unused.current);
    setPrepared({});
    return kept ? { provider, session: kept.session, model: kept.model } : { provider };
  };

  return { prepared, read, pick, launch };
}
