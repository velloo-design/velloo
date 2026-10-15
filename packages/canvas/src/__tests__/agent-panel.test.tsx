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

domSuite("the transcript", () => {
  test("a sent card and a design edit both lead back to the canvas", async () => {
    const { TurnView } = await import("../components/Agent/conversation.tsx");
    const revealed: unknown[] = [];
    const turn = {
      id: "t",
      status: "completed" as const,
      startedAt: now,
      completedAt: now,
      items: [
        {
          kind: "user" as const,
          id: "u",
          text: "Fix it",
          context: [
            {
              kind: "node" as const,
              ref: { boardId: "pricing", screenId: "hero", path: "0" },
              label: "Pricing › Hero › CTA",
            },
          ],
        },
        {
          kind: "tool" as const,
          id: "x",
          name: "call_velloo",
          server: "velloo",
          status: "completed" as const,
          input: '{"operation": "update_props", "arguments": {"screenId": "hero"}}',
        },
      ],
    };
    const view = await mount(
      <TurnView
        turn={turn}
        providerLabel="Codex"
        waiting={false}
        callbacks={{ onReveal: (t) => revealed.push(t) }}
      />,
    );
    await interact(() =>
      ($('[aria-label="Show Pricing › Hero › CTA on the canvas"]') as HTMLElement).click(),
    );
    await interact(() => ($("[data-agent-work] button") as HTMLElement).click());
    const show = $$("[data-agent-step=tool] button").find((b) =>
      text(b).startsWith("Show on canvas"),
    );
    await interact(() => show?.click());
    expect(revealed).toEqual([
      { boardId: "pricing", screenId: "hero", path: "0" },
      { screenId: "hero" },
    ]);
    expect(text($("[data-agent-work]"))).toContain("1 design edit");
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

  test("the keyboard sends: ⌘/Ctrl+Enter in the box, and the box is labelled for screen readers", async () => {
    let sent = 0;
    const view = await mount(
      <AgentComposer {...props} text="Tighten the hero" onSend={() => sent++} />,
    );
    const box = $("textarea") as HTMLTextAreaElement;
    expect($(`label[for="${box.id}"]`)?.textContent).toBe("Message to Codex");
    await interact(() => press(box, "Enter"));
    expect(sent).toBe(0);
    await interact(() => press(box, "Enter", { metaKey: true }));
    await interact(() => press(box, "Enter", { ctrlKey: true }));
    expect(sent).toBe(2);
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

domSuite("comments in the composer", () => {
  const commentThread = {
    id: "t1",
    scope: "local" as const,
    folderId: "f",
    boardId: "pricing",
    anchor: { kind: "board" as const, boardId: "pricing", x: 0, y: 0 },
    anchorState: { status: "board" as const },
    origin: { kind: "local" as const },
    status: "open" as const,
    messages: [
      {
        id: "m1",
        author: { kind: "reviewer" as const, displayName: "Maya" },
        body: "The CTA is cramped",
        createdAt: now,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
  const idle = () => {
    routes["GET /api/agent/sessions"] = { sessions: [{ ...session, state: "idle" }] };
    routes["GET /api/agent/sessions/s1"] = {
      ...snapshot,
      approvals: [],
      turns: [],
      session: { ...session, state: "idle" },
    };
    routes["GET /api/comments/t1"] = { thread: commentThread };
    routes["POST /api/agent/sessions/s1/turns"] = { mode: "started", turnId: "turn-9" };
  };

  test("a thread's Add to agent puts a card in the composer and opens the Agent tab", async () => {
    idle();
    const { CommentThreadListItem } = await import("../components/comment-threads.tsx");
    useCanvas.setState({
      rightTab: "comments",
      boards: { pricing: { id: "pricing", name: "Pricing", frames: [] } } as never,
    });
    const view = await mount(
      <ul>
        <CommentThreadListItem
          thread={commentThread}
          number={1}
          onOpen={() => {}}
          onLocate={() => {}}
          onAddToAgent={() => void useCanvas.getState().addCommentsToAgent([{ threadId: "t1" }])}
        />
      </ul>,
    );
    await interact(() => ($('[aria-label="Add comment 1 to the agent"]') as HTMLElement).click());
    await settle(10);
    expect(useCanvas.getState().rightTab).toBe("agent");
    expect(useCanvas.getState().agentDraft.context).toEqual([
      {
        kind: "comment",
        ref: { boardId: "pricing", threadId: "t1", messageId: "m1" },
        label: "Pricing",
        detail: "The CTA is cramped",
        author: "Maya",
      },
    ]);
    await view.unmount();
  });

  test("the cards can be sent alone, or with text", async () => {
    idle();
    const view = await mount(<AgentPanel />);
    await settle(10);
    await interact(() => useCanvas.getState().addCommentsToAgent([{ threadId: "t1" }]));
    await settle(10);
    expect(text($("[data-agent-composer]"))).toContain("1 comment attached");
    expect(text($("[data-agent-comment]"))).toContain("Maya");
    const send = () => $$("[data-agent-composer] button").find((b) => text(b) === "Send");
    await interact(() => send()?.click());
    await settle(10);
    const alone = requests.filter((r) => r.path === "/api/agent/sessions/s1/turns").at(-1)
      ?.body as { text: string; context: unknown[] };
    expect(alone.text).toBe("");
    expect(alone.context).toHaveLength(1);

    await interact(() => useCanvas.getState().addCommentsToAgent([{ threadId: "t1" }]));
    await settle(10);
    await interact(() => useCanvas.getState().setAgentDraftText("Only on mobile"));
    await interact(() => send()?.click());
    await settle(10);
    const withText = requests.filter((r) => r.path === "/api/agent/sessions/s1/turns").at(-1)
      ?.body as { text: string };
    expect(withText.text).toBe("Only on mobile");
    await view.unmount();
  });

  test("a resolved comment shows as stale, and a card can be removed", async () => {
    idle();
    routes["GET /api/comments/t1"] = { thread: { ...commentThread, status: "resolved" } };
    const view = await mount(<AgentPanel />);
    await settle(10);
    await interact(() => useCanvas.getState().addCommentsToAgent([{ threadId: "t1" }]));
    await settle(10);
    expect(text($("[data-agent-comment]"))).toContain("Resolved");
    await interact(() => ($('[aria-label="Remove the comment by Maya"]') as HTMLElement).click());
    expect(useCanvas.getState().agentDraft.context).toEqual([]);
    await view.unmount();
  });

  test("a sent comment says it went to the agent and can be resolved from the conversation", async () => {
    idle();
    const card = {
      kind: "comment" as const,
      ref: { boardId: "pricing", threadId: "t1", messageId: "m1" },
      label: "Pricing",
      detail: "The CTA is cramped",
      author: "Maya",
    };
    routes["GET /api/agent/sessions/s1"] = {
      ...snapshot,
      approvals: [],
      session: { ...session, state: "idle" },
      turns: [
        {
          id: "t",
          status: "completed",
          startedAt: now,
          completedAt: now,
          items: [{ kind: "user", id: "u", text: "", context: [card] }],
        },
      ],
    };
    routes["PATCH /api/comments/t1"] = { thread: { ...commentThread, status: "resolved" } };
    const view = await mount(<AgentPanel />);
    await settle(20);
    expect(text($("[data-agent-user]"))).toContain("Sent to agent");
    const resolve = $$("[data-agent-user] button").find((b) => text(b) === "Resolve");
    await interact(() => resolve?.click());
    await settle(10);
    expect(requests.some((r) => r.method === "PATCH" && r.path === "/api/comments/t1")).toBe(true);
    await view.unmount();
  });
});

domSuite("new cloud comments", () => {
  const cloudThread = {
    id: "c1",
    scope: "shared" as const,
    folderId: "f",
    boardId: "pricing",
    anchor: { kind: "board" as const, boardId: "pricing", x: 0, y: 0 },
    anchorState: { status: "board" as const },
    origin: { kind: "published" as const, slug: "s", versionId: "v" },
    status: "open" as const,
    messages: [
      { id: "old", author: { kind: "user" as const }, body: "Ready for review", createdAt: now },
      {
        id: "r1",
        author: { kind: "reviewer" as const, displayName: "Jon" },
        body: "Plan names in sentence case",
        createdAt: now,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
  const arrival = { boardId: "pricing", threadIds: ["c1"], messageIds: ["r1"] };

  beforeEach(() => {
    routes["GET /api/comments/c1"] = { thread: cloudThread };
    useCanvas.setState({
      commentArrivals: [],
      boards: { pricing: { id: "pricing", name: "Pricing", frames: [] } } as never,
    });
  });

  test("a repeated sync of the same comments is one notice, naming the board and the count", async () => {
    useCanvas.getState().receiveCommentArrival(arrival);
    useCanvas.getState().receiveCommentArrival(arrival);
    useCanvas
      .getState()
      .receiveCommentArrival({ boardId: "pricing", threadIds: ["c1"], messageIds: ["r2"] });
    expect(useCanvas.getState().commentArrivals).toEqual([
      { boardId: "pricing", threadIds: ["c1"], messageIds: ["r1", "r2"] },
    ]);
    const view = await mount(<AgentPanel />);
    await settle(10);
    expect(
      $$("[data-agent-arrival]").map((el) => text(el.querySelector('[data-slot="alert-title"]'))),
    ).toEqual(["2 new comments on Pricing"]);
    await view.unmount();
  });

  test("Add to agent puts the new reply in the composer as a card, sends nothing, and stops offering it", async () => {
    useCanvas.getState().receiveCommentArrival(arrival);
    const view = await mount(<AgentPanel />);
    await settle(10);
    const add = $$("[data-agent-arrival] button").find((b) => text(b) === "Add to agent");
    await interact(() => add?.click());
    await settle(10);
    expect(useCanvas.getState().rightTab).toBe("agent");
    expect(useCanvas.getState().agentDraft.context).toEqual([
      {
        kind: "comment",
        ref: { boardId: "pricing", threadId: "c1", messageId: "r1" },
        label: "Pricing",
        detail: "Plan names in sentence case",
        author: "Jon",
      },
    ]);
    expect(requests.find((r) => r.path === "/api/comments/arrivals/ack")?.body).toEqual({
      messageIds: ["r1"],
    });
    expect(requests.some((r) => r.path.includes("/turns"))).toBe(false);
    expect($("[data-agent-arrival]")).toBeNull();

    // Offered again (a second tab, a late frame): the card isn't duplicated.
    await interact(() => useCanvas.getState().receiveCommentArrival(arrival));
    const again = $$("[data-agent-arrival] button").find((b) => text(b) === "Add to agent");
    await interact(() => again?.click());
    await settle(10);
    expect(useCanvas.getState().agentDraft.context).toHaveLength(1);
    await view.unmount();
  });

  test("dismissing acknowledges the comments without adding them", async () => {
    useCanvas.getState().receiveCommentArrival(arrival);
    const view = await mount(<AgentPanel />);
    await settle(10);
    await interact(() =>
      ($('[aria-label="Dismiss: 1 new comment on Pricing"]') as HTMLElement).click(),
    );
    await settle(10);
    expect(useCanvas.getState().commentArrivals).toEqual([]);
    expect(useCanvas.getState().agentDraft.context).toEqual([]);
    expect(requests.find((r) => r.path === "/api/comments/arrivals/ack")?.body).toEqual({
      messageIds: ["r1"],
    });
    await view.unmount();
  });
});

domSuite("where the person is", () => {
  const pricing = {
    id: "pricing",
    name: "Pricing",
    frames: [{ id: "f1", screen: "hero", x: 0, y: 0, w: 100, h: 100 }],
  };
  const live = () => {
    routes["GET /api/agent/sessions"] = { sessions: [{ ...session, state: "idle" }] };
    routes["GET /api/agent/sessions/s1"] = {
      ...snapshot,
      approvals: [],
      turns: [],
      session: { ...session, state: "idle" },
    };
    routes["POST /api/agent/sessions/s1/turns"] = { mode: "started", turnId: "t9" };
    useCanvas.setState({
      boards: { pricing } as never,
      currentBoardId: "pricing",
      currentScreenId: "hero",
    });
  };
  const sentContext = () =>
    (
      requests.filter((r) => r.path === "/api/agent/sessions/s1/turns").at(-1)?.body as {
        context?: { kind: string; label: string; ref?: unknown }[];
      }
    )?.context;

  test("the open board goes with every message, shown as a card that can be taken off", async () => {
    live();
    const view = await mount(<AgentPanel />);
    await settle(10);
    expect(text($('[data-agent-card="view"]'))).toContain("Viewing Pricing");
    await interact(() => useCanvas.getState().setAgentDraftText("Describe this board"));
    await interact(() =>
      $$("[data-agent-composer] button")
        .find((b) => text(b) === "Send")
        ?.click(),
    );
    await settle(10);
    expect(sentContext()).toEqual([
      { kind: "view", ref: { boardId: "pricing" }, label: "Pricing" },
    ]);

    await interact(() => ($('[aria-label="Remove Viewing Pricing"]') as HTMLElement).click());
    expect($('[data-agent-suggestion="view"]')).not.toBeNull();
    await interact(() => useCanvas.getState().setAgentDraftText("Something general"));
    await interact(() =>
      $$("[data-agent-composer] button")
        .find((b) => text(b) === "Send")
        ?.click(),
    );
    await settle(10);
    expect(sentContext()).toBeUndefined();
    // Taking it off is for one message; the next one carries it again.
    expect(useCanvas.getState().agentViewIncluded).toBe(true);
    await view.unmount();
  });

  test("a comment written while the agent is in use goes to its composer, not the threads", async () => {
    live();
    routes["POST /api/comments"] = {
      thread: {
        id: "nt",
        scope: "local",
        folderId: "f",
        boardId: "pricing",
        origin: { kind: "local" },
        status: "open",
        anchorState: { status: "board" },
        messages: [{ id: "nm", author: { kind: "user" }, body: "Tighter", createdAt: now }],
        createdAt: now,
        updatedAt: now,
      },
    };
    routes["GET /api/comments/nt"] = routes["POST /api/comments"] as { thread: unknown };
    useCanvas.setState({ rightTab: "agent", agentSessions: [{ ...session, state: "idle" }] });
    const anchor = { kind: "board" as const, boardId: "pricing", x: 1, y: 2 };
    await interact(() => useCanvas.getState().beginComment(anchor));
    expect(useCanvas.getState().rightTab).toBe("agent");
    await interact(async () => {
      await useCanvas.getState().createPendingComment("Tighter");
    });
    expect(useCanvas.getState().rightTab).toBe("agent");
    expect(useCanvas.getState().activeCommentId).toBeNull();
    expect(
      useCanvas.getState().agentDraft.context.map((c) => `${c.kind}:${c.ref.threadId}`),
    ).toEqual(["comment:nt"]);
  });

  test("with no agent in use, a comment still opens its thread", async () => {
    useCanvas.setState({ rightTab: "node", agentSessions: [], currentBoardId: "pricing" });
    await interact(() =>
      useCanvas.getState().beginComment({ kind: "board", boardId: "pricing", x: 1, y: 2 }),
    );
    expect(useCanvas.getState().rightTab).toBe("comments");
  });
});

domSuite("starting and switching sessions", () => {
  test("the agent used last is offered first; with none used, they're offered alike", async () => {
    const both = { providers: [codex, { ...claude, status: "ready" as const }] };
    routes["GET /api/agent/providers"] = both;
    const view = await mount(<AgentPanel />);
    await settle(10);
    const variant = (id: string) =>
      $$(`[data-agent-provider="${id}"] button`)
        .find((b) => text(b) === "Start session")
        ?.getAttribute("data-variant");
    expect([variant("codex"), variant("claude-code")]).toEqual(["outline", "outline"]);
    await view.unmount();

    routes["GET /api/agent/sessions"] = {
      sessions: [{ ...session, provider: "claude-code", state: "exited" }],
    };
    useCanvas.setState({ agentProviders: null, agentActiveSessionId: null });
    const again = await mount(<AgentPanel />);
    await settle(10);
    expect([variant("codex"), variant("claude-code")]).toEqual(["outline", "default"]);
    await again.unmount();
  });

  test("the header's + starts a new session from the picker", async () => {
    routes["GET /api/agent/sessions"] = { sessions: [{ ...session, state: "idle" }] };
    routes["GET /api/agent/sessions/s1"] = {
      ...snapshot,
      approvals: [],
      session: { ...session, state: "idle" },
    };
    const view = await mount(<AgentPanel />);
    await settle(10);
    await interact(() => ($('[aria-label="New session"]') as HTMLElement).click());
    expect($("[data-agent-start]")).not.toBeNull();
    await view.unmount();
  });
});
