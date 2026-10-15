import { afterEach, beforeEach, expect, test } from "bun:test";
import type {
  AgentApprovalRequest,
  AgentProviderInfo,
  AgentSessionSnapshot,
  AgentSessionSummary,
} from "@velloo/protocol/agent";
import { $, $$, domSuite, interact, mount, press, settle, text } from "./dom.ts";
import { screenFixture, serveFolder } from "./fake-server.ts";

const { useCanvas } = await import("../store.ts");
const { setApiConnected } = await import("../api/connection.ts");
const { ApprovalCard } = await import("../components/Agent/conversation.tsx");
const { AgentComposer } = await import("../components/Agent/composer.tsx");
const { AgentPanel } = await import("../components/Agent/AgentPanel.tsx");

const realFetch = globalThis.fetch;
let requests: { method: string; path: string; body?: unknown }[];
let routes: Record<string, unknown>;

const capabilities = {
  resume: true,
  history: true,
  rename: true,
  interrupt: true,
  followUp: "steer" as const,
  approvals: ["allow-once" as const, "allow-session" as const, "deny" as const, "abort" as const],
  turnDiff: true,
};
const codex: AgentProviderInfo = {
  id: "codex",
  label: "Codex",
  status: "ready",
  version: "0.159.0",
  account: "ChatGPT Plus",
  capabilities,
};
const claude: AgentProviderInfo = {
  id: "claude-code",
  label: "Claude Code",
  status: "logged-out",
  message: "Claude Code isn't signed in. Run `claude` in a terminal and sign in, then check again.",
  capabilities: { ...capabilities, followUp: "queue" },
};
const now = new Date().toISOString();
const session: AgentSessionSummary = {
  id: "s1",
  provider: "codex",
  title: "Make the hero taller",
  state: "awaiting-approval",
  resumable: true,
  providerSessionId: "t1",
  terminalCommand: ["codex", "resume", "t1"],
  environment: {
    execution: "local",
    host: "mac",
    cwd: "/Users/ana/acme/web",
    sandbox: "workspace-write",
    approvalMode: "on-request",
    model: "gpt-6",
    providerVersion: "0.159.0",
  },
  createdAt: now,
  updatedAt: now,
};
const approval: AgentApprovalRequest = {
  id: "codex-7",
  turnId: "turn-1",
  kind: "command",
  title: "Run a command",
  command: "rm -rf .next && bun run build",
  cwd: "/Users/ana/acme/web",
  reason: "Clears the stale build cache.",
  decisions: ["allow-once", "allow-session", "deny", "abort"],
  requestedAt: now,
};
const snapshot: AgentSessionSnapshot = {
  session,
  turnsDropped: 0,
  approvals: [approval],
  queued: [],
  turns: [
    {
      id: "turn-1",
      status: "running",
      startedAt: now,
      items: [
        {
          kind: "user",
          id: "u1",
          text: "Make the hero taller",
          context: [
            {
              kind: "node",
              ref: { screenId: "hero", path: "0" },
              label: "Pricing › Hero › Button",
            },
          ],
        },
        { kind: "agent-text", id: "a1", text: "I'll clear the `.next` cache and rebuild." },
        {
          kind: "command",
          id: "c1",
          command: "rm -rf .next && bun run build",
          status: "running",
          output: "",
        },
      ],
    },
  ],
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  requests = [];
  routes = {
    "GET /api/agent/providers": { providers: [codex, claude] },
    "GET /api/agent/sessions": { sessions: [] },
  };
  setApiConnected(true);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    requests.push({ method, path: url.pathname + url.search, body });
    const key = `${method} ${url.pathname}`;
    if (key in routes) return json(routes[key]);
    if (method !== "GET") return json({ ok: true });
    return json({ error: { kind: "BadRequest", message: "not found" } }, 404);
  }) as typeof fetch;
  useCanvas.setState({
    agentProviders: null,
    agentSessions: [],
    agentTranscripts: {},
    agentActiveSessionId: null,
    agentDraft: { text: "", context: [] },
    agentCommentThreads: {},
    agentProtocolMismatch: false,
    boards: {},
    screens: {},
    currentBoardId: null,
    currentScreenId: null,
    selection: null,
  });
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

domSuite("the approval card", () => {
  test("offers only the provider's decisions and answers to the keyboard", async () => {
    const answers: string[] = [];
    const view = await mount(
      <ApprovalCard
        request={{ ...approval, decisions: ["allow-once", "deny"] }}
        providerLabel="Claude Code"
        onAnswer={(d) => answers.push(d)}
      />,
    );
    expect(text($("[data-agent-approval]"))).toContain("Claude Code wants to run a command");
    expect(text($("[data-agent-approval]"))).toContain("in ~/acme/web");
    expect($$("[data-agent-approval] button").map((b) => text(b))).toEqual([
      "Allow once↵",
      "DenyEsc",
    ]);
    const button = $$("[data-agent-approval] button")[0] as HTMLElement;
    await interact(() => press(button, "Enter", { metaKey: true }));
    expect(answers).toEqual([]);
    await interact(() => press(button, "Escape"));
    expect(answers).toEqual(["deny"]);
    await view.unmount();
  });

  test("⌘↵ allows for the session when the provider offers it", async () => {
    const answers: string[] = [];
    const view = await mount(
      <ApprovalCard request={approval} providerLabel="Codex" onAnswer={(d) => answers.push(d)} />,
    );
    await interact(() =>
      press($$("[data-agent-approval] button")[0] as HTMLElement, "Enter", { ctrlKey: true }),
    );
    expect(answers).toEqual(["allow-session"]);
    await view.unmount();
  });
});

domSuite("the composer", () => {
  const props = {
    text: "",
    cards: [],
    suggestions: [],
    staleness: () => undefined,
    providerLabel: "Codex",
    running: false,
    followUp: "steer" as const,
    queued: [],
    onText() {},
    onSend() {},
    onStop() {},
    onAttach() {},
    onRemove() {},
    onClearComments() {},
    onDequeue() {},
  };
  const action = () => $$("[data-agent-composer] button").at(-1) as HTMLButtonElement;

  test("nothing to send disables Send; comment cards alone are enough", async () => {
    const view = await mount(<AgentComposer {...props} />);
    expect(action().disabled).toBe(true);
    await view.render(
      <AgentComposer
        {...props}
        cards={[
          {
            kind: "comment",
            ref: { threadId: "t", messageId: "m" },
            label: "Pricing › CTA",
            detail: "Bigger",
            author: "Maya",
          },
        ]}
      />,
    );
    expect(text($("[data-agent-composer]"))).toContain("1 comment attached");
    expect(($("textarea") as HTMLTextAreaElement).placeholder).toBe(
      "Add instructions, or send the comments on their own",
    );
    expect(action().disabled).toBe(false);
    await view.unmount();
  });

  test("while the agent works, an empty box offers Stop and a typed one steers", async () => {
    let stopped = 0;
    const view = await mount(<AgentComposer {...props} running onStop={() => stopped++} />);
    expect(text(action())).toBe("Stop");
    await interact(() => action().click());
    expect(stopped).toBe(1);
    await view.render(<AgentComposer {...props} running text="also the footer" />);
    expect(text(action())).toBe("Steer");
    await view.unmount();
  });

  test("a stale card says why, and every card can be removed", async () => {
    const removed: string[] = [];
    const card = {
      kind: "node" as const,
      ref: { screenId: "hero", path: "0.4" },
      label: "Pricing › Hero › Badge",
    };
    const view = await mount(
      <AgentComposer
        {...props}
        cards={[card]}
        staleness={() => "gone"}
        onRemove={(c) => removed.push(c.label)}
      />,
    );
    expect(text($("[data-agent-card]"))).toContain("Deleted");
    await interact(() =>
      ($('[aria-label="Remove Pricing › Hero › Badge"]') as HTMLElement).click(),
    );
    expect(removed).toEqual(["Pricing › Hero › Badge"]);
    await view.unmount();
  });
});

domSuite("the Agent tab", () => {
  test("with no session, lists the agents with what each needs", async () => {
    const view = await mount(<AgentPanel />);
    await settle(10);
    expect($$("[data-agent-provider]").map((el) => el.dataset.agentProvider)).toEqual([
      "codex",
      "claude-code",
    ]);
    expect(text($('[data-agent-provider="claude-code"]'))).toContain("Not signed in");
    expect(text($('[data-agent-provider="claude-code"]'))).toContain("Run `claude` in a terminal");
    expect(text($("[data-agent-start]"))).toContain("Velloo never sees your credentials");
    await view.unmount();
  });

  test("starting a session asks for the provider only", async () => {
    routes["POST /api/agent/sessions"] = { session: { ...session, state: "idle" } };
    routes["GET /api/agent/sessions/s1"] = {
      ...snapshot,
      approvals: [],
      turns: [],
      session: { ...session, state: "idle" },
    };
    const view = await mount(<AgentPanel />);
    await settle(10);
    const start = $$('[data-agent-provider="codex"] button').find(
      (b) => text(b) === "Start session",
    );
    await interact(() => start?.click());
    await settle(10);
    expect(requests.find((r) => r.method === "POST")).toEqual({
      method: "POST",
      path: "/api/agent/sessions",
      body: { provider: "codex" },
    });
    expect($("[data-agent-session-header]")).not.toBeNull();
    await view.unmount();
  });

  test("a session in progress shows its turn, its environment and the approval waiting on the person", async () => {
    routes["GET /api/agent/sessions"] = { sessions: [session] };
    routes["GET /api/agent/sessions/s1"] = snapshot;
    const view = await mount(<AgentPanel />);
    await settle(10);
    const header = text($("[data-agent-session-header]"));
    expect(header).toContain("Make the hero taller");
    expect(header).toContain("Waiting for you");
    expect(header).toContain(
      "Local · Codex 0.159.0 · gpt-6 · ~/acme/web · workspace-write · asks on request",
    );
    expect(text($("[data-agent-user]"))).toContain("Pricing › Hero › Button");
    expect(text($('[role="log"]'))).toContain("Paused for your approval");
    const allow = $$("[data-agent-approval] button").find((b) => text(b).startsWith("Allow once"));
    await interact(() => allow?.click());
    await settle(10);
    expect(requests.at(-1)).toEqual({
      method: "POST",
      path: "/api/agent/sessions/s1/approvals/codex-7",
      body: { decision: "allow-once" },
    });
    await view.unmount();
  });

  test("sending clears the box at once and carries the attached cards", async () => {
    routes["GET /api/agent/sessions"] = { sessions: [{ ...session, state: "idle" }] };
    routes["GET /api/agent/sessions/s1"] = {
      ...snapshot,
      approvals: [],
      session: { ...session, state: "idle" },
    };
    routes["POST /api/agent/sessions/s1/turns"] = { mode: "started", turnId: "turn-2" };
    const view = await mount(<AgentPanel />);
    await settle(10);
    const card = { kind: "board" as const, ref: { boardId: "pricing" }, label: "Pricing" };
    await interact(() => {
      useCanvas.getState().setAgentDraftText("Tighten the spacing");
      useCanvas.getState().addAgentContext([card]);
    });
    const send = $$("[data-agent-composer] button").find((b) => text(b) === "Send");
    await interact(() => send?.click());
    expect(useCanvas.getState().agentDraft).toEqual({ text: "", context: [] });
    await settle(10);
    expect(requests.find((r) => r.path === "/api/agent/sessions/s1/turns")?.body).toEqual({
      text: "Tighten the spacing",
      context: [card],
    });
    await view.unmount();
  });

  test("a failed send puts the draft back", async () => {
    routes["GET /api/agent/sessions"] = { sessions: [{ ...session, state: "idle" }] };
    routes["GET /api/agent/sessions/s1"] = {
      ...snapshot,
      approvals: [],
      session: { ...session, state: "idle" },
    };
    const view = await mount(<AgentPanel />);
    await settle(10);
    globalThis.fetch = (async () =>
      json(
        { error: { kind: "BadRequest", message: "isn't running" } },
        409,
      )) as unknown as typeof fetch;
    await interact(() => useCanvas.getState().setAgentDraftText("hello"));
    await interact(async () => {
      await useCanvas.getState().sendAgentPrompt();
    });
    expect(useCanvas.getState().agentDraft.text).toBe("hello");
    await view.unmount();
  });
});

domSuite("the right panel", () => {
  test("has an Agent tab, and selecting on the canvas doesn't pull the person away from it", async () => {
    const { RightPanel } = await import("../components/RightPanel.tsx");
    const server = serveFolder({ boards: { main: ["home"] } });
    useCanvas.setState({
      rightTab: "agent",
      rightPaneCollapsed: false,
      wsConnected: true,
      boards: { main: server.boards.main } as never,
      screens: { home: screenFixture("home") },
      currentBoardId: "main",
      currentScreenId: "home",
    });
    const view = await mount(<RightPanel screenId="home" />);
    await settle(10);
    expect($$('[role="tab"]').map((t) => t.getAttribute("aria-label"))).toEqual([
      "Node",
      "Theme",
      "Comments",
      "Agent",
    ]);
    expect($("[data-agent-start]")).not.toBeNull();
    await interact(() =>
      useCanvas.setState({
        selection: { screenId: "home", path: "0" },
        selectionIntent: "inspect",
      }),
    );
    expect(useCanvas.getState().rightTab).toBe("agent");
    await interact(() => useCanvas.setState({ rightTab: "comments" }));
    await interact(() =>
      useCanvas.setState({
        selection: { screenId: "home", path: "1" },
        selectionIntent: "inspect",
      }),
    );
    expect(useCanvas.getState().rightTab).toBe("node");
    await view.unmount();
    server.restore();
  });
});
