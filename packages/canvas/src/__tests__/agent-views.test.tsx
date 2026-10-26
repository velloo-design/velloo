import { expect, test } from "bun:test";
import type { AgentItem, AgentSessionSummary, AgentTurn } from "@velloo/protocol/agent";
import { $, $$, domSuite, interact, mount, press, settle, text } from "./dom.ts";

const { TurnView } = await import("../components/Agent/conversation.tsx");
const { SessionHeader, AgentStart } = await import("../components/Agent/session.tsx");
const { AgentText } = await import("../components/Agent/agent-text.tsx");

const now = new Date().toISOString();
const turn = (items: AgentItem[], extra: Partial<AgentTurn> = {}): AgentTurn => ({
  id: "t",
  status: "completed",
  startedAt: now,
  completedAt: now,
  items: [{ kind: "user", id: "u", text: "go" }, ...items],
  ...extra,
});

/** Radix opens a dropdown on pointerdown, not click. */
async function openMenu(trigger: Element | null | undefined) {
  await interact(() => {
    trigger?.dispatchEvent(
      new window.PointerEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: false }),
    );
    (trigger as HTMLElement | null)?.click();
  });
  await settle();
}

const menuItem = (label: string) =>
  $$('[role="menuitem"], [role="menuitemcheckbox"]').find((el) => text(el) === label);

domSuite("a turn's work", () => {
  test("a command's output and a file's diff open in full, and long runs fold their earliest steps", async () => {
    const items: AgentItem[] = [
      { kind: "agent-text", id: "a", text: "Running the tests" },
      {
        kind: "command",
        id: "c",
        command: "bun test",
        status: "failed",
        exitCode: 1,
        output: "line one\nline two\nline three",
        outputDropped: 1200,
      },
      {
        kind: "file-change",
        id: "f",
        status: "completed",
        changes: [
          {
            path: "/app/src/a.ts",
            change: "update",
            diff: "--- a\n+++ b\n@@\n-old\n+new\n context",
            diffTruncated: true,
          },
        ],
      },
      { kind: "subagent", id: "s", description: "Check the docs", status: "completed" },
      { kind: "reasoning", id: "r", text: "Weighing two layouts" },
      {
        kind: "plan",
        id: "p",
        steps: [
          { text: "Look", status: "completed" },
          { text: "Fix", status: "in-progress" },
          { text: "Ship", status: "pending" },
        ],
      },
      {
        kind: "tool",
        id: "x",
        name: "WebFetch",
        status: "failed",
        input: "https://example.com",
        output: "403",
      },
    ];
    const view = await mount(
      <TurnView
        turn={turn(items)}
        provider="codex"
        providerLabel="Codex"
        waiting={false}
        callbacks={{ cwd: "/app" }}
      />,
    );
    await interact(() => ($("[data-agent-work] button") as HTMLElement).click());
    expect(text($("[data-agent-work]"))).toContain("Show 1 earlier step");
    await interact(() =>
      $$("[data-agent-work] button")
        .find((b) => text(b) === "Show 1 earlier step")
        ?.click(),
    );

    const command = $('[data-agent-step="command"]');
    expect(text(command)).toContain("exit 1");
    expect($$('[data-agent-step="command"] button span').map((el) => el.textContent)).toEqual([
      "line two",
      "line three",
    ]);
    await interact(() => ($('[aria-label="Show output"]') as HTMLElement).click());
    expect(text(command)).toContain("1,200 characters earlier");
    expect(text(command)).toContain("line one");

    const file = $('[data-agent-step="file-change"]');
    expect(text(file)).toContain("src/a.ts");
    expect(text(file)).toContain("+1");
    expect(text(file)).toContain("−1");
    await interact(() =>
      ($('[aria-label="Show the diff of /app/src/a.ts"]') as HTMLElement).click(),
    );
    expect(text(file)).toContain("diff cut short");

    expect(text($('[data-agent-step="subagent"]'))).toContain("Check the docs");
    expect(text($('[data-agent-step="reasoning"]'))).toContain("Weighing two layouts");
    expect(
      $$('[data-agent-step="plan"] [aria-label]').map((el) => el.getAttribute("aria-label")),
    ).toEqual(["Done", "In progress", "To do"]);
    expect(text($('[data-agent-step="tool"]'))).toContain("403");
    await view.unmount();
  });

  test("how a turn ends: done, stopped, failed, or paused for the person", async () => {
    const cases: [Partial<AgentTurn>, boolean, string][] = [
      [{ status: "completed" }, false, "Done in 0s"],
      [{ status: "interrupted" }, false, "Stopped"],
      [{ status: "failed", error: "Rate limited for an hour" }, false, "Rate limited for an hour"],
      [{ status: "running", completedAt: undefined }, true, "Paused for your approval"],
    ];
    for (const [extra, waiting, expected] of cases) {
      const view = await mount(
        <TurnView
          turn={turn(
            [{ kind: "notice", id: "n", level: "error", text: "MCP server down" }],
            extra as AgentTurn,
          )}
          provider="codex"
          providerLabel="Codex"
          waiting={waiting}
          callbacks={{}}
        />,
      );
      expect(text(view.host)).toContain(expected);
      expect($('[role="alert"]')?.textContent).toContain("MCP server down");
      await view.unmount();
    }
  });

  test("a working turn says what it's doing right now", async () => {
    const view = await mount(
      <TurnView
        turn={turn(
          [
            {
              kind: "file-change",
              id: "f",
              status: "running",
              changes: [{ path: "/app/src/hero.tsx", change: "update" }],
            },
          ],
          { status: "running" },
        )}
        provider="codex"
        providerLabel="Codex"
        waiting={false}
        callbacks={{ cwd: "/app" }}
      />,
    );
    expect(text(view.host)).toContain("Editing src/hero.tsx");
    await view.unmount();
    const quiet = await mount(
      <TurnView
        turn={turn([], { status: "running" })}
        provider="codex"
        providerLabel="Codex"
        waiting={false}
        callbacks={{}}
      />,
    );
    expect(text(quiet.host)).toContain("Thinking…");
    await quiet.unmount();
  });
});

const summary = (extra: Partial<AgentSessionSummary> = {}): AgentSessionSummary => ({
  id: "s1",
  provider: "codex",
  title: "Hero pass",
  state: "idle",
  resumable: true,
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
  ...extra,
});

function header(extra: Partial<AgentSessionSummary>, calls: string[], runningSince?: string) {
  return (
    <SessionHeader
      session={summary(extra)}
      sessions={[summary(extra), summary({ id: "s2", title: "Older" })]}
      provider={undefined}
      runningSince={runningSince}
      onSwitch={(id) => calls.push(`switch:${id}`)}
      onNew={() => calls.push("new")}
      onRename={(title) => calls.push(`rename:${title}`)}
      onCopyResume={() => calls.push("copy")}
      onStop={() => calls.push("stop")}
      onReopen={() => calls.push("reopen")}
      onDelete={() => calls.push("delete")}
      onBack={() => calls.push("back")}
      onNewWithAgent={() => calls.push("new-with-agent")}
    />
  );
}

domSuite("the session header", () => {
  test("says each state in words", async () => {
    const states: [AgentSessionSummary["state"], string][] = [
      ["starting", "Starting…"],
      ["running", "Working…"],
      ["awaiting-approval", "Waiting for you"],
      ["idle", "Ready"],
      ["exited", "Stopped"],
      ["failed", "Stopped unexpectedly"],
    ];
    for (const [state, words] of states) {
      const view = await mount(header({ state, stateMessage: "Codex crashed" }, []));
      expect(text($("[data-agent-session-header]"))).toContain(words);
      await view.unmount();
    }
  });

  test("a running turn's clock ticks, and a stopped session offers Reopen", async () => {
    const calls: string[] = [];
    const view = await mount(
      header({ state: "running" }, calls, new Date(Date.now() - 65_000).toISOString()),
    );
    expect(text($("[data-agent-session-header]"))).toContain("1:05");
    await view.render(
      header(
        { state: "exited", stateMessage: "Stopped. Reopen the session to continue it." },
        calls,
      ),
    );
    expect(text($("[data-agent-session-header]"))).toContain("Reopen the session to continue it.");
    await interact(() =>
      $$("[data-agent-session-header] button")
        .find((b) => text(b) === "Reopen")
        ?.click(),
    );
    expect(calls).toEqual(["reopen"]);
    await view.unmount();
  });

  test("the environment opens to say where and how it runs", async () => {
    const view = await mount(header({}, []));
    const toggle = $$("[data-agent-session-header] button").find((b) =>
      text(b).startsWith("Local ·"),
    );
    expect(text(toggle ?? null)).toBe(
      "Local · codex 0.159.0 · gpt-6 · ~/acme/web · workspace-write · asks on request",
    );
    await interact(() => toggle?.click());
    const details = text($("[data-agent-session-header] dl"));
    expect(details).toContain("On this computer (mac)");
    expect(details).toContain("/Users/ana/acme/web");
    expect(details).toContain("Yes — from Velloo or a terminal");
    await view.unmount();
  });

  test("the menus switch, rename, copy, stop and delete", async () => {
    const calls: string[] = [];
    const view = await mount(header({}, calls));
    await openMenu($('[aria-label="Session: Hero pass. Switch session"]'));
    await interact(() => menuItem("Older")?.click());
    await openMenu($('[aria-label="Session menu"]'));
    await interact(() => menuItem("Copy resume command")?.click());
    await openMenu($('[aria-label="Session menu"]'));
    await interact(() => menuItem("Stop agent")?.click());
    await openMenu($('[aria-label="Session menu"]'));
    await interact(() => menuItem("Rename")?.click());
    await settle(10);
    const input = $('[aria-label="Session name"]') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, "Hero pass".length]);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    await interact(() => {
      setter?.call(input, "Hero, take two");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await interact(() => press(input, "Enter"));
    expect(calls).toEqual(["switch:s2", "copy", "stop", "rename:Hero, take two"]);
    await view.render(header({ state: "exited" }, calls));
    await openMenu($('[aria-label="Session menu"]'));
    await interact(() => menuItem("Delete session")?.click());
    expect(calls.at(-1)).toBe("delete");
    await view.unmount();
  });
});

domSuite("the start screen", () => {
  test("recent sessions open, reopen, or say they can't", async () => {
    const calls: string[] = [];
    const view = await mount(
      <AgentStart
        providers={[]}
        recent={[
          summary({ state: "exited" }),
          summary({ id: "s2", title: "Gone", state: "exited", resumable: false }),
        ]}
        starting={null}
        onStart={() => {}}
        onCheckAgain={() => calls.push("check")}
        onOpen={(id) => calls.push(`open:${id}`)}
        onReopen={(id) => calls.push(`reopen:${id}`)}
      />,
    );
    expect(text($('[aria-label="Recent sessions"]'))).toContain("Can't be reopened");
    await interact(() =>
      $$('[aria-label="Recent sessions"] button')
        .find((b) => text(b) === "Hero pass")
        ?.click(),
    );
    await interact(() =>
      $$('[aria-label="Recent sessions"] button')
        .find((b) => text(b) === "Reopen")
        ?.click(),
    );
    expect(calls).toEqual(["open:s1", "reopen:s1"]);
    expect(
      $$('[aria-label="Recent sessions"] button').filter((b) => text(b) === "Reopen"),
    ).toHaveLength(1);
    await view.unmount();
  });
});

domSuite("an agent's text", () => {
  test("renders headings, both list kinds and code blocks as elements", async () => {
    const view = await mount(
      <AgentText text={"## Plan\n1. one\n2. two\n- a\n\n```\nconst x = 1;\n```"} />,
    );
    expect(view.host.querySelector("h3")?.textContent).toBe("Plan");
    expect(view.host.querySelectorAll("ol li")).toHaveLength(2);
    expect(view.host.querySelectorAll("ul li")).toHaveLength(1);
    expect(view.host.querySelector("pre code")?.textContent).toBe("const x = 1;");
    await view.unmount();
  });
});
