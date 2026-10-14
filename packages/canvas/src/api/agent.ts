import type {
  AgentApprovalDecision,
  AgentContextCard,
  AgentHistoryEntry,
  AgentProviderInfo,
  AgentSessionSnapshot,
  AgentSessionSummary,
} from "@velloo/protocol/agent";
import { getJson } from "./discovery.ts";
import { requestJson } from "./http.ts";

const session = (id: string) => `/api/agent/sessions/${encodeURIComponent(id)}`;

/** The Agent tab's daemon API: local CLI agent sessions for this design. */
export const agent = {
  providers(refresh = false) {
    return getJson<{ providers: AgentProviderInfo[] }>(
      `/api/agent/providers${refresh ? "?refresh=1" : ""}`,
      "agent providers",
    );
  },
  history(provider: string) {
    return getJson<{ sessions: AgentHistoryEntry[] }>(
      `/api/agent/history?provider=${encodeURIComponent(provider)}`,
      "agent history",
    );
  },
  sessions() {
    return getJson<{ sessions: AgentSessionSummary[] }>("/api/agent/sessions", "agent sessions");
  },
  snapshot(id: string) {
    return getJson<AgentSessionSnapshot>(session(id), "agent session");
  },
  start(args: { provider: string; resume?: string }) {
    return requestJson<{ session: AgentSessionSummary }>("POST", "/api/agent/sessions", args);
  },
  reopen(id: string) {
    return requestJson<{ session: AgentSessionSummary }>("POST", `${session(id)}/reopen`);
  },
  prompt(id: string, args: { text: string; context?: AgentContextCard[] }) {
    return requestJson<{ mode: "started" | "steered" | "queued"; turnId?: string }>(
      "POST",
      `${session(id)}/turns`,
      args,
    );
  },
  dequeue(id: string, queuedId: string) {
    return requestJson<unknown>("DELETE", `${session(id)}/queue/${encodeURIComponent(queuedId)}`);
  },
  interrupt(id: string) {
    return requestJson<unknown>("POST", `${session(id)}/interrupt`);
  },
  answer(id: string, approvalId: string, decision: AgentApprovalDecision) {
    return requestJson<unknown>(
      "POST",
      `${session(id)}/approvals/${encodeURIComponent(approvalId)}`,
      {
        decision,
      },
    );
  },
  rename(id: string, title: string) {
    return requestJson<{ session: AgentSessionSummary }>("PATCH", session(id), { title });
  },
  stop(id: string) {
    return requestJson<unknown>("POST", `${session(id)}/stop`);
  },
  remove(id: string) {
    return requestJson<unknown>("DELETE", session(id));
  },
};
