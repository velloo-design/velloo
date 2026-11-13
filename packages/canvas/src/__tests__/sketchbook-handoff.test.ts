import { afterEach, beforeEach, expect, test } from "bun:test";
import type { AgentContextCard, AgentSessionSummary } from "@velloo/protocol/agent";
import { useCanvas } from "../store.ts";

/**
 * Restyle and Recompose hand the work to an agent the way the sketchbook's
 * Build does: the card goes with a one-line message to the session that is
 * running, or waits for the person to pick an agent — never to the sketchbook
 * the canvas last had open.
 */

const realFetch = globalThis.fetch;
let posts: { path: string; body: unknown }[];

const session = (id: string): AgentSessionSummary => ({
  id,
  provider: "codex",
  title: id,
  state: "idle",
  resumable: true,
  createdAt: "2026-11-13",
  updatedAt: "2026-11-13",
});

const card: AgentContextCard = {
  kind: "restyle",
  ref: { boardId: "main", screenId: "home" },
  label: "Restyle · Home",
};

beforeEach(() => {
  posts = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    if (init?.method === "POST") {
      posts.push({ path: url.pathname, body: JSON.parse(String(init.body ?? "null")) });
    }
    return new Response(JSON.stringify({ mode: "started" }), {
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  useCanvas.setState({
    agentProviders: [],
    agentSessions: [session("s1")],
    agentActiveSessionId: "s1",
    sketchbookId: "earlier",
    sketchbookAsk: null,
    sketchbookAskCards: null,
    view: "boards",
  });
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

test("with an agent running, the card goes to it and the open sketchbook is left alone", async () => {
  await useCanvas.getState().askAgentAbout("Restyle “Home” with this board's Look.", card);
  expect(posts).toEqual([
    {
      path: "/api/agent/sessions/s1/turns",
      body: { text: "Restyle “Home” with this board's Look.", context: [card] },
    },
  ]);
  expect(useCanvas.getState().rightTab).toBe("agent");
  expect(useCanvas.getState().sketchbookAskCards).toBeNull();
});

test("with none, the ask and its card wait for the person to pick an agent", async () => {
  useCanvas.setState({ agentActiveSessionId: null });
  await useCanvas.getState().askAgentAbout("Recompose it.", card);
  expect(posts).toEqual([]);
  expect(useCanvas.getState().sketchbookAsk).toBe("Recompose it.");
  expect(useCanvas.getState().sketchbookAskCards).toEqual([card]);
  useCanvas.getState().cancelSketchbookAsk();
  expect(useCanvas.getState().sketchbookAskCards).toBeNull();
});
