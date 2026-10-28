import { afterEach, beforeEach, expect, test } from "bun:test";
import type {
  AgentApprovalRequest,
  AgentProviderInfo,
  AgentSessionSnapshot,
  AgentSessionSummary,
} from "@velloo/protocol/agent";
import { $, $$, domSuite, interact, mount, press, settle, text, typeInto } from "./dom.ts";
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

  test("always allow says what it saves, and takes a click rather than a key", async () => {
    const answers: string[] = [];
    const view = await mount(
      <ApprovalCard
        request={{
          ...approval,
          decisions: ["allow-once", "allow-session", "allow-always", "deny", "abort"],
          always: "Don't ask again for Bash(npm test) in this project.",
        }}
        providerLabel="Claude Code"
        onAnswer={(d) => answers.push(d)}
      />,
    );
    const always = $$("[data-agent-approval] button").find((b) =>
      text(b).startsWith("Always allow"),
    ) as HTMLElement;
    expect(text(always)).toBe("Always allowDon't ask again for Bash(npm test) in this project.");
    await interact(() => press(always, "Enter"));
    expect(answers).toEqual([]);
    await interact(() => always.click());
    expect(answers).toEqual(["allow-always"]);
    await view.unmount();
  });
});

domSuite("an agent's question", () => {
  const question: AgentApprovalRequest = {
    id: "q1",
    kind: "question",
    title: "Which alias?",
    decisions: ["allow-once", "deny"],
    requestedAt: now,
    questions: [
      {
        id: "Which alias?",
        header: "Alias fix",
        question: "Which alias?",
        options: [
          { label: "Edit the config", description: "Add @/* to config.json" },
          { label: "Leave it" },
        ],
        other: true,
      },
      {
        id: "Which pages?",
        question: "Which pages?",
        options: [{ label: "Home" }, { label: "Billing" }],
        multiSelect: true,
      },
    ],
  };
  type Answered = [string, Record<string, string[]> | undefined];

  test("shows each question and its options, and sends what was picked", async () => {
    const answered: Answered[] = [];
    const view = await mount(
      <ApprovalCard
        request={question}
        providerLabel="Claude Code"
        onAnswer={(d, a) => answered.push([d, a])}
      />,
    );
    const card = $("[data-agent-approval=question]");
    expect(text(card)).toContain("Claude Code is asking");
    expect(text(card)).toContain("Alias fix");
    expect(text(card)).toContain("Which alias?");
    expect(text(card)).toContain("Add @/* to config.json");
    const submit = $$("[data-agent-approval] button").find((b) => text(b).startsWith("Answer"));
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    const inputs = $$("[data-agent-approval] input") as HTMLInputElement[];
    await interact(() => inputs[0]?.click());
    await interact(() => inputs[3]?.click());
    await interact(() => inputs[4]?.click());
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    await interact(() => (submit as HTMLButtonElement).click());
    expect(answered).toEqual([
      ["allow-once", { "Which alias?": ["Edit the config"], "Which pages?": ["Home", "Billing"] }],
    ]);
    await view.unmount();
  });

  test("the person's own words replace a single pick, and Esc skips", async () => {
    const answered: Answered[] = [];
    const view = await mount(
      <ApprovalCard
        request={{ ...question, questions: question.questions?.slice(0, 1) }}
        providerLabel="Codex"
        onAnswer={(d, a) => answered.push([d, a])}
      />,
    );
    const inputs = $$("[data-agent-approval] input") as HTMLInputElement[];
    await interact(() => inputs[0]?.click());
    await interact(() => typeInto(inputs[2] as HTMLInputElement, "Fix the tsconfig instead"));
    expect(inputs[0]?.checked).toBe(false);
    await interact(() => ($("[data-agent-approval] form") as HTMLFormElement).requestSubmit());
    expect(answered).toEqual([["allow-once", { "Which alias?": ["Fix the tsconfig instead"] }]]);
    await view.unmount();

    const skipped: Answered[] = [];
    const again = await mount(
      <ApprovalCard
        request={question}
        providerLabel="Codex"
        onAnswer={(d, a) => skipped.push([d, a])}
      />,
    );
    await interact(() => press($("[data-agent-approval] input") as HTMLElement, "Escape"));
    expect(skipped).toEqual([["deny", undefined]]);
    await again.unmount();
  });

  test("a question with nothing to pick from still says what it asks", async () => {
    const view = await mount(
      <ApprovalCard
        request={{ ...question, questions: undefined, decisions: ["deny"] }}
        providerLabel="Codex"
        onAnswer={() => {}}
      />,
    );
    expect(text($("[data-agent-approval]"))).toContain("Which alias?");
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
        provider="codex"
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
    attachable: [],
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

  test("Enter sends, as in every agent's prompt; Shift+Enter and composing don't; the box is labelled", async () => {
    let sent = 0;
    const view = await mount(
      <AgentComposer {...props} text="Tighten the hero" onSend={() => sent++} />,
    );
    const box = $("textarea") as HTMLTextAreaElement;
    expect($(`label[for="${box.id}"]`)?.textContent).toBe("Message to Codex");
    await interact(() => press(box, "Enter", { shiftKey: true }));
    await interact(() => {
      box.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, isComposing: true }),
      );
    });
    expect(sent).toBe(0);
    await interact(() => press(box, "Enter"));
    await interact(() => press(box, "Enter", { metaKey: true }));
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
  test("opens on the agent, beside Design (Node and Theme, which keeps its place) and Comments", async () => {
    const { RightPanel } = await import("../components/RightPanel.tsx");
    const { createInspectorSlice } = await import("../store/inspector.ts");
    expect(
      createInspectorSlice(
        () => {},
        () => ({}) as never,
        {} as never,
      ).rightTab,
    ).toBe("agent");
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
    const tabNames = () => $$('[role="tab"]').map((t) => t.textContent?.trim());
    expect(tabNames()).toEqual(["Agent", "Design", "Comments"]);
    const tab = (name: string) =>
      $$('[role="tab"]').find(
        (t) => t.textContent?.trim() === name || t.getAttribute("aria-label") === name,
      ) as HTMLElement;
    const press = (el: HTMLElement) =>
      interact(() => {
        el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
        el.click();
      });
    await press(tab("Design"));
    expect(useCanvas.getState().rightTab).toBe("node");
    expect(tabNames()).toEqual(["Agent", "Design", "Comments", "Node", "Theme"]);
    await press(tab("Theme"));
    expect(useCanvas.getState().rightTab).toBe("theme");
    await press(tab("Comments"));
    expect(useCanvas.getState().rightTab).toBe("comments");
    expect(tabNames()).toEqual(["Agent", "Design", "Comments"]);
    await press(tab("Agent"));
    expect(useCanvas.getState().rightTab).toBe("agent");
    await press(tab("Design"));
    expect(useCanvas.getState().rightTab).toBe("theme");
    await view.unmount();
    server.restore();
  });

  test("selecting on the canvas doesn't pull the person away from the agent", async () => {
    const { RightPanel } = await import("../components/RightPanel.tsx");
    const server = serveFolder({ boards: { main: ["home"] } });
    useCanvas.setState({
      // A comment in progress keeps the pane where it is; none is, here.
      cursorMode: "select",
      activeCommentId: null,
      pendingCommentAnchor: null,
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
    frames: [{ id: "f1", screen: "hero", x: 0, y: 0, w: 100, h: 100, label: "1 · Hero" }],
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

  test("the open board goes with every message, and no frame unless one is added", async () => {
    live();
    const view = await mount(<AgentPanel />);
    await settle(10);
    expect(text($('[data-agent-card="view"]'))).toBe("Viewing Pricing");
    expect($('[aria-label="Remove Viewing Pricing"]')).toBeNull();
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
    await view.unmount();
  });

  test("the session's details name its ID, the one the agent resumes by", async () => {
    live();
    const view = await mount(<AgentPanel />);
    await settle(10);
    const trigger = $$("button").find((b) => text(b).startsWith("Local ·")) as HTMLElement;
    await interact(() => trigger.click());
    expect(text($("[data-agent-session-id]"))).toBe("t1");
    expect($('[aria-label="Copy the session ID"]')).not.toBeNull();
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
  test("the agent to start leads the list: the one used last, else the first ready", async () => {
    const both = { providers: [codex, { ...claude, status: "ready" as const }] };
    routes["GET /api/agent/providers"] = both;
    const view = await mount(<AgentPanel />);
    await settle(10);
    const variant = (id: string) =>
      $$(`[data-agent-provider="${id}"] button`)
        .find((b) => text(b) === "Start session")
        ?.getAttribute("data-variant");
    const order = () =>
      $$("[data-agent-provider]").map((el) => el.getAttribute("data-agent-provider"));
    expect(order()).toEqual(["codex", "claude-code"]);
    expect(text($("[data-agent-start]"))).toContain(
      "GitHub Copilot, Cursor, Gemini CLI, OpenCode and other agents that speak ACP appear here",
    );
    expect([variant("codex"), variant("claude-code")]).toEqual(["default", "outline"]);
    expect(text($('[data-agent-provider="codex"]'))).not.toContain("Last used");
    await view.unmount();

    routes["GET /api/agent/sessions"] = {
      sessions: [{ ...session, provider: "claude-code", state: "exited" }],
    };
    useCanvas.setState({ agentProviders: null, agentActiveSessionId: null });
    const again = await mount(<AgentPanel />);
    await settle(10);
    expect(order()).toEqual(["claude-code", "codex"]);
    expect([variant("codex"), variant("claude-code")]).toEqual(["outline", "default"]);
    expect(text($('[data-agent-provider="claude-code"]'))).toContain("Last used");
    expect(
      $('[data-agent-provider="claude-code"] [data-provider-logo="claude-code"]'),
    ).not.toBeNull();
    await again.unmount();

    routes["GET /api/agent/providers"] = {
      providers: [...both.providers, { ...codex, id: "opencode", label: "OpenCode" }],
    };
    useCanvas.setState({ agentProviders: null, agentActiveSessionId: null });
    const withOpenCode = await mount(<AgentPanel />);
    await settle(10);
    expect(text($("[data-agent-start]"))).toContain(
      "GitHub Copilot, Cursor, Gemini CLI and other agents",
    );
    expect($('[data-agent-provider="opencode"] [data-provider-logo="opencode"]')).not.toBeNull();
    await withOpenCode.unmount();
  });

  test("the header's back goes to the agents, and + starts another session with this one", async () => {
    routes["GET /api/agent/sessions"] = { sessions: [{ ...session, state: "idle" }] };
    routes["GET /api/agent/sessions/s1"] = {
      ...snapshot,
      approvals: [],
      session: { ...session, state: "idle" },
    };
    routes["POST /api/agent/sessions"] = { session: { ...session, id: "s2", state: "starting" } };
    routes["GET /api/agent/sessions/s2"] = {
      ...snapshot,
      approvals: [],
      turns: [],
      session: { ...session, id: "s2", state: "idle" },
    };
    const view = await mount(<AgentPanel />);
    await settle(10);
    await interact(() => ($('[aria-label="Back to agents"]') as HTMLElement).click());
    expect($("[data-agent-start]")).not.toBeNull();
    expect(useCanvas.getState().agentActiveSessionId).toBeNull();
    await interact(() => useCanvas.getState().selectAgentSession("s1"));
    await settle(10);
    const plus = $$("[data-agent-session-header] button").find((b) =>
      b.getAttribute("aria-label")?.startsWith("New "),
    ) as HTMLElement;
    expect(plus.getAttribute("aria-label")).toBe(`New ${"Codex"} session`);
    await interact(() => plus.click());
    await settle(10);
    const started = requests.filter((r) => r.method === "POST" && r.path === "/api/agent/sessions");
    expect(started.map((r) => (r.body as { provider: string }).provider)).toEqual([
      session.provider,
    ]);
    await view.unmount();
  });
});

domSuite("the store's session actions", () => {
  test("each action reaches its route on the active session", async () => {
    routes["GET /api/agent/sessions/s1"] = { ...snapshot, session: { ...session, state: "idle" } };
    routes["POST /api/agent/sessions/s1/reopen"] = { session: { ...session, state: "idle" } };
    routes["PATCH /api/agent/sessions/s1"] = { session: { ...session, title: "Renamed" } };
    useCanvas.setState({ agentActiveSessionId: "s1", agentSessions: [session] });
    const s = useCanvas.getState();
    await s.interruptAgent();
    await s.answerAgentApproval("codex-7", "deny");
    await s.dequeueAgentPrompt("q1");
    await s.renameAgentSession("s1", "Renamed");
    expect(useCanvas.getState().agentSessions[0]?.title).toBe("Renamed");
    await s.stopAgentSession("s1");
    await s.reopenAgentSession("s1");
    await s.refreshAgentProviders();
    const sent = requests
      .filter((r) => r.method !== "GET" || r.path.includes("refresh"))
      .map((r) => `${r.method} ${r.path}`);
    expect(sent).toEqual([
      "POST /api/agent/sessions/s1/interrupt",
      "POST /api/agent/sessions/s1/approvals/codex-7",
      "DELETE /api/agent/sessions/s1/queue/q1",
      "PATCH /api/agent/sessions/s1",
      "POST /api/agent/sessions/s1/stop",
      "POST /api/agent/sessions/s1/reopen",
      "GET /api/agent/providers?refresh=1",
    ]);
    await s.removeAgentSession("s1");
    expect(useCanvas.getState().agentActiveSessionId).toBeNull();
    await s.selectAgentSession("s1");
    expect(useCanvas.getState().agentTranscripts.s1?.approvals).toHaveLength(1);
    await s.selectAgentSession(null);
    expect(useCanvas.getState().agentActiveSessionId).toBeNull();
  });

  test("a frame from another protocol version asks for a reload instead of drawing half a conversation", async () => {
    useCanvas
      .getState()
      .applyAgentFrame({ type: "agent", v: 99, event: "session-removed", sessionId: "x" });
    expect(useCanvas.getState().agentProtocolMismatch).toBe(true);
    const view = await mount(<AgentPanel />);
    await settle(10);
    expect(text(view.host)).toContain("Velloo was updated");
    expect($$("button").some((b) => text(b) === "Reload")).toBe(true);
    await view.unmount();
  });
});

domSuite("a session that isn't running", () => {
  test("says so, reopens, and copies the command that resumes it in a terminal", async () => {
    const stopped = { ...session, state: "exited" as const, stateMessage: "Stopped." };
    routes["GET /api/agent/sessions"] = { sessions: [stopped] };
    routes["GET /api/agent/sessions/s1"] = { ...snapshot, approvals: [], session: stopped };
    routes["POST /api/agent/sessions/s1/reopen"] = { session: { ...session, state: "idle" } };
    useCanvas.setState({ agentActiveSessionId: "s1" });
    const copied: string[] = [];
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (t: string) => void copied.push(t) },
    });
    const view = await mount(<AgentPanel />);
    await settle(10);
    expect(text(view.host)).toContain("Codex isn't running. Reopen the session to continue it");
    expect($("[data-agent-composer]")).toBeNull();
    await interact(() => {
      const trigger = $('[aria-label="Session menu"]');
      trigger?.dispatchEvent(
        new window.PointerEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: false }),
      );
      (trigger as HTMLElement | null)?.click();
    });
    await settle();
    await interact(() =>
      $$('[role="menuitem"]')
        .find((el) => text(el) === "Copy resume command")
        ?.click(),
    );
    await settle(10);
    expect(copied).toEqual(['cd "/Users/ana/acme/web" && codex resume t1']);
    const reopen = $$("button")
      .filter((b) => text(b) === "Reopen")
      .at(-1);
    await interact(() => reopen?.click());
    await settle(10);
    expect(
      requests.some((r) => r.method === "POST" && r.path === "/api/agent/sessions/s1/reopen"),
    ).toBe(true);
    await view.unmount();
  });
});

domSuite("the composer's queue, selection and frames menu", () => {
  const frame = {
    kind: "frame" as const,
    ref: { boardId: "pricing", frameId: "f1", screenId: "hero" },
    label: "1 · Hero, desktop",
  };
  const node = {
    kind: "node" as const,
    ref: { boardId: "pricing", screenId: "hero", path: "0", frameId: "f1" },
    label: "1 · Hero, desktop › cta",
  };
  const base = {
    text: "",
    staleness: () => undefined,
    providerLabel: "Claude Code",
    followUp: "queue" as const,
    onText() {},
    onSend() {},
    onStop() {},
    onClearComments() {},
  };
  const openMenu = async () => {
    await interact(() => {
      const trigger = $('[aria-label="Attach frames from this board"]');
      trigger?.dispatchEvent(
        new window.PointerEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: false }),
      );
      (trigger as HTMLElement | null)?.click();
    });
    await settle();
  };

  test("a queued message can be taken back, and the frames menu attaches and detaches by name", async () => {
    const dequeued: string[] = [];
    const log: string[] = [];
    const view = await mount(
      <AgentComposer
        {...base}
        cards={[]}
        attachable={[frame]}
        running
        queued={[{ id: "q1", text: "Then the footer" }]}
        onAttach={(c) => log.push(`+${c.label}`)}
        onRemove={(c) => log.push(`-${c.label}`)}
        onDequeue={(id) => dequeued.push(id)}
      />,
    );
    expect(($("textarea") as HTMLTextAreaElement).placeholder).toBe(
      "Queue a follow-up for Claude Code…",
    );
    await interact(() =>
      ($('[aria-label="Remove queued message Then the footer"]') as HTMLElement).click(),
    );
    expect(dequeued).toEqual(["q1"]);
    await openMenu();
    const items = $$('[role="menuitemcheckbox"]');
    expect(items.map((el) => [text(el), el.getAttribute("aria-checked")])).toEqual([
      ["1 · Hero, desktop", "false"],
    ]);
    await interact(() => (items[0] as HTMLElement).click());
    await view.render(
      <AgentComposer
        {...base}
        cards={[frame]}
        attachable={[frame]}
        running
        queued={[]}
        onAttach={(c) => log.push(`+${c.label}`)}
        onRemove={(c) => log.push(`-${c.label}`)}
        onDequeue={() => {}}
      />,
    );
    const checked = $$('[role="menuitemcheckbox"]');
    expect(checked[0]?.getAttribute("aria-checked")).toBe("true");
    await interact(() => (checked[0] as HTMLElement).click());
    expect(log).toEqual(["+1 · Hero, desktop", "-1 · Hero, desktop"]);
    await view.unmount();
  });

  test("what is selected on the canvas is one press from the message, until it's attached", async () => {
    const attached: string[] = [];
    const view = await mount(
      <AgentComposer
        {...base}
        cards={[]}
        attachable={[]}
        selection={node}
        running={false}
        queued={[]}
        onAttach={(c) => attached.push(c.label)}
        onRemove={() => {}}
        onDequeue={() => {}}
      />,
    );
    const chip = $('[data-agent-suggestion="node"]') as HTMLElement;
    expect(text(chip)).toBe("cta");
    expect(chip.getAttribute("title")).toBe("Add the selected cta to your message");
    await interact(() => chip.click());
    expect(attached).toEqual(["1 · Hero, desktop › cta"]);
    await view.render(
      <AgentComposer
        {...base}
        cards={[node]}
        attachable={[]}
        selection={node}
        running={false}
        queued={[]}
        onAttach={() => {}}
        onRemove={() => {}}
        onDequeue={() => {}}
      />,
    );
    expect($('[data-agent-suggestion="node"]')).toBeNull();
    expect($('[data-agent-card="node"]')).not.toBeNull();
    await openMenu();
    expect(text($('[role="menuitem"]'))).toBe("Open a board to attach its frames");
    await view.unmount();
  });

  test("the permission mode shows in the box and switches from its menu", async () => {
    const picked: string[] = [];
    const modes = [
      { id: "default", label: "Ask", description: "Asks first" },
      { id: "plan", label: "Plan" },
    ];
    const view = await mount(
      <AgentComposer
        {...base}
        cards={[]}
        attachable={[]}
        running={false}
        queued={[]}
        controls={{ commands: [], models: [], modes, mode: "default" }}
        onMode={(m) => picked.push(m)}
        onAttach={() => {}}
        onRemove={() => {}}
        onDequeue={() => {}}
      />,
    );
    const trigger = $("[data-agent-mode]") as HTMLElement;
    expect(trigger.getAttribute("aria-label")).toBe("Permission mode: Ask. Change it");
    await interact(() => {
      trigger.dispatchEvent(
        new window.PointerEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: false }),
      );
      trigger.click();
    });
    await settle();
    const radios = $$('[role="menuitemradio"]');
    expect(radios.map((r) => [text(r), r.getAttribute("aria-checked")])).toEqual([
      ["AskAsks first", "true"],
      ["Plan", "false"],
    ]);
    await interact(() => (radios[1] as HTMLElement).click());
    expect(picked).toEqual(["plan"]);
    // A mode set in the agent's own config, not one offered here, is still named.
    await view.render(
      <AgentComposer
        {...base}
        cards={[]}
        attachable={[]}
        running={false}
        queued={[]}
        controls={{ commands: [], models: [], modes, mode: "bypassPermissions" }}
        onAttach={() => {}}
        onRemove={() => {}}
        onDequeue={() => {}}
      />,
    );
    expect(text($("[data-agent-mode]"))).toBe("bypassPermissions");
    await view.unmount();
  });
});

domSuite("slash commands", () => {
  const controls = {
    commands: [
      { name: "review", description: "Review the changes", argumentHint: "[pr]" },
      { name: "init" },
    ],
    models: [
      { id: "a", label: "Model A" },
      { id: "b", label: "Model B", description: "Bigger" },
    ],
    model: "a",
    mcp: { actions: ["reconnect" as const, "enable" as const, "disable" as const] },
  };
  const live = (extra: Partial<typeof controls> = {}) => {
    routes["GET /api/agent/sessions"] = { sessions: [{ ...session, state: "idle" }] };
    routes["GET /api/agent/sessions/s1"] = {
      ...snapshot,
      approvals: [],
      turns: [],
      session: { ...session, state: "idle" },
      controls: { ...controls, ...extra },
    };
  };
  const box = () => $("[data-agent-composer] textarea") as HTMLTextAreaElement;
  const menu = () => $$('[data-agent-slash-menu] [role="option"]').map((o) => text(o));
  const names = () =>
    $$('[data-agent-slash-menu] [role="option"] .font-medium').map((o) => o.textContent);

  test("a slash opens the menu; arrows and Enter put the agent's command in the box", async () => {
    live();
    const view = await mount(<AgentPanel />);
    await settle(10);
    expect(box().placeholder).toBe("Ask Codex, or type / for commands");
    await interact(() => useCanvas.getState().setAgentDraftText("/"));
    expect(names()).toEqual(["/model", "/mcp", "/review", "/init"]);
    expect(box().getAttribute("aria-expanded")).toBe("true");
    await interact(() => press(box(), "ArrowDown"));
    await interact(() => press(box(), "ArrowDown"));
    await interact(() => press(box(), "ArrowUp"));
    expect(box().getAttribute("aria-activedescendant")).toMatch(/-1$/);
    await interact(() => press(box(), "ArrowDown"));
    await interact(() => press(box(), "Enter"));
    expect(useCanvas.getState().agentDraft.text).toBe("/review ");
    expect($("[data-agent-slash-menu]")).toBeNull();

    // Escape puts the menu away until the slash is gone.
    await interact(() => useCanvas.getState().setAgentDraftText("/in"));
    expect(menu()).toHaveLength(1);
    await interact(() => press(box(), "Escape"));
    expect($("[data-agent-slash-menu]")).toBeNull();
    await interact(() => useCanvas.getState().setAgentDraftText(""));
    await interact(() => useCanvas.getState().setAgentDraftText("/i"));
    expect(names()).toEqual(["/init", "/review"]);
    await view.unmount();
  });

  test("a command goes alone: the attached cards wait for the next message", async () => {
    live();
    routes["POST /api/agent/sessions/s1/turns"] = { mode: "started", turnId: "t9" };
    const view = await mount(<AgentPanel />);
    await settle(10);
    const card = { kind: "board" as const, ref: { boardId: "pricing" }, label: "Pricing" };
    await interact(() => {
      useCanvas.getState().addAgentContext([card]);
      useCanvas.getState().setAgentDraftText("/review 12");
    });
    await interact(() => press(box(), "Enter", { metaKey: true }));
    await settle(5);
    const sent = requests.find((r) => r.path === "/api/agent/sessions/s1/turns");
    expect(sent?.body).toEqual({ text: "/review 12" });
    expect(useCanvas.getState().agentDraft).toEqual({ text: "", context: [card] });
    await view.unmount();
  });

  test("/model picks from the session's models; typed in full it opens the same panel", async () => {
    live();
    routes["POST /api/agent/sessions/s1/model"] = {
      session: { ...session, state: "idle", environment: { ...session.environment, model: "b" } },
    };
    const view = await mount(<AgentPanel />);
    await settle(10);
    await interact(() => useCanvas.getState().setAgentDraftText("/mo"));
    expect(menu()[0]).toContain("Switch the model (now Model A)");
    await interact(() => press(box(), "Tab"));
    expect(useCanvas.getState().agentDraft.text).toBe("");
    const radios = $$('[data-agent-control="Model"] [role="radio"]');
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["true", "false"]);
    expect(document.activeElement).toBe(radios[0] ?? null);
    await interact(() => (radios[1] as HTMLElement).click());
    await settle(5);
    expect(requests.find((r) => r.path === "/api/agent/sessions/s1/model")?.body).toEqual({
      model: "b",
    });
    expect($('[data-agent-control="Model"]')).toBeNull();

    await interact(() => useCanvas.getState().setAgentDraftText("/model"));
    await interact(() => press(box(), "Escape"));
    await interact(() => press(box(), "Enter", { metaKey: true }));
    expect($('[data-agent-control="Model"]')).not.toBeNull();
    expect(requests.some((r) => r.path === "/api/agent/sessions/s1/turns")).toBe(false);
    await interact(() => ($('[aria-label="Close Model"]') as HTMLElement).click());
    expect($('[data-agent-control="Model"]')).toBeNull();
    await view.unmount();
  });

  test("/mcp shows the agent's servers, this design's first, and acts on one", async () => {
    live();
    routes["GET /api/agent/sessions/s1/mcp"] = {
      servers: [
        { name: "github", status: "failed", detail: "spawn ENOENT" },
        { name: "velloo", status: "connected", tools: 4, velloo: true },
        { name: "linear", status: "disabled" },
      ],
    };
    const view = await mount(<AgentPanel />);
    await settle(10);
    await interact(() => useCanvas.getState().setAgentDraftText("/mcp"));
    await interact(() => press(box(), "Enter"));
    await settle(5);
    const rows = $$("[data-mcp-server]");
    expect(rows.map((r) => r.getAttribute("data-mcp-server"))).toEqual([
      "velloo",
      "github",
      "linear",
    ]);
    expect(text(rows[0] as HTMLElement)).toContain("This design");
    expect(text(rows[0] as HTMLElement)).toContain("4 tools");
    expect(text(rows[1] as HTMLElement)).toContain("Failed");
    // This design's server can be reconnected but not switched off from here.
    expect($('[aria-label="velloo on for this session"]')).toBeNull();
    expect($('[aria-label="Reconnect linear"]')).toBeNull();
    await interact(() => ($('[aria-label="Reconnect github"]') as HTMLElement).click());
    await settle(5);
    await interact(() => ($('[aria-label="linear on for this session"]') as HTMLElement).click());
    await settle(5);
    expect(
      requests.filter((r) => r.method === "POST" && r.path === "/api/agent/sessions/s1/mcp"),
    ).toEqual([
      {
        method: "POST",
        path: "/api/agent/sessions/s1/mcp",
        body: { server: "github", action: "reconnect" },
      },
      {
        method: "POST",
        path: "/api/agent/sessions/s1/mcp",
        body: { server: "linear", action: "enable" },
      },
    ]);
    const reads = () =>
      requests.filter((r) => r.path === "/api/agent/sessions/s1/mcp" && r.method === "GET");
    const before = reads().length;
    await interact(() => ($('[aria-label="Check the servers again"]') as HTMLElement).click());
    await settle(5);
    expect(reads().length).toBe(before + 1);
    await view.unmount();
  });

  test("an agent with no models or server list offers only its own commands", async () => {
    live({ models: [], mcp: undefined } as never);
    routes["GET /api/agent/sessions/s1/mcp"] = undefined as never;
    const view = await mount(<AgentPanel />);
    await settle(10);
    await interact(() => useCanvas.getState().setAgentDraftText("/"));
    expect(names()).toEqual(["/review", "/init"]);
    await view.unmount();
  });

  test("a server list that can't be read says so", async () => {
    live();
    const view = await mount(<AgentPanel />);
    await settle(10);
    await interact(() => useCanvas.getState().setAgentDraftText("/mcp"));
    await interact(() => press(box(), "Enter"));
    await settle(5);
    expect(text($('[data-agent-control="MCP servers"]') as HTMLElement)).toContain(
      "Couldn't read the servers",
    );
    await view.unmount();
  });
});
