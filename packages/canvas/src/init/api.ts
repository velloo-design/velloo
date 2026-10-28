import type { AgentProviderInfo } from "@velloo/protocol/agent";
import type {
  InitCapture,
  InitCheckBody,
  InitCreateBody,
  InitCreated,
  InitModels,
  InitOpenBody,
  InitPlace,
  InitState,
} from "@velloo/protocol/init";

/**
 * The setup server's API. It is not the daemon — there is no design yet and
 * no socket — so this talks to it directly instead of through the canvas's
 * connection-gated helpers.
 */
async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const payload: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const message = (payload as { error?: { message?: string } } | undefined)?.error?.message;
    throw new Error(message ?? `Velloo setup isn't answering (${res.status}).`);
  }
  return payload as T;
}

export const init = {
  state(appRoot?: string) {
    return call<InitState>(
      "GET",
      `/api/init/state${appRoot ? `?appRoot=${encodeURIComponent(appRoot)}` : ""}`,
    );
  },
  check(body: InitCheckBody) {
    return call<InitPlace>("POST", "/api/init/check", body);
  },
  create(body: InitCreateBody) {
    return call<InitCreated>("POST", "/api/init/create", body);
  },
  agents() {
    return call<{ providers: AgentProviderInfo[] }>("GET", "/api/init/agents");
  },
  models(provider: string) {
    return call<InitModels>("POST", "/api/init/models", { provider });
  },
  open(body: InitOpenBody) {
    return call<{ url: string }>("POST", "/api/init/open", body);
  },
  capture() {
    return call<InitCapture>("GET", "/api/init/capture");
  },
  startCapture() {
    return call<InitCapture>("POST", "/api/init/capture/start");
  },
  finishCapture() {
    return call<{ prompt?: string }>("POST", "/api/init/capture/finish");
  },
  openExisting() {
    return call<{ url: string }>("POST", "/api/init/open-existing");
  },
};
