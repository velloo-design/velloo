import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ACP_AGENTS, AcpAdapter, type AcpAgentSpec } from "../agent/acp/adapter.ts";
import { permissionDecisions, toolCallItem } from "../agent/acp/normalize.ts";
import { findExecutable } from "../agent/process.ts";
import { AgentSessionManager } from "../agent/sessions.ts";

const FAKE = join(import.meta.dir, "fixtures", "fake-acp.ts");
const spec: AcpAgentSpec = {
  id: "fake-acp",
  label: "Fake ACP",
  executable: "fake-acp",
  args: [],
  install: "Install it.",
  signIn: "Run `fake login` in a terminal.",
};
let dir: string;

const adapter = (command: string[] = [process.execPath, FAKE]) => new AcpAdapter(spec, { command });

function manager(adapters = [adapter()]) {
  return new AgentSessionManager({
    adapters,
    broadcast: () => undefined,
    launch: () => ({
      cwd: dir,
      mcp: { name: "velloo", url: "http://127.0.0.1:9/mcp", command: ["velloo", "mcp", "/design"] },
      instructions: "You are in the canvas.",
    }),
    storeDir: join(dir, "store"),
  });
}

async function until(check: () => boolean, ms = 5_000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await Bun.sleep(10);
  }
}

const logged = async () =>
  (await readFile(join(dir, "acp.log"), "utf8").catch(() => ""))
    .split("\n")
    .filter(Boolean)
    .map(
      (l) =>
        JSON.parse(l) as {
          method?: string;
          params?: Record<string, unknown>;
          permission?: unknown;
        },
    );

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "velloo-acp-"));
  process.env.FAKE_ACP_LOG = join(dir, "acp.log");
  delete process.env.FAKE_ACP_MODE;
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("an Agent Client Protocol agent", () => {
  test("is ready with the capabilities it advertises", async () => {
    const info = await adapter().discover();
    expect(info).toMatchObject({ status: "ready", version: "3.2.1" });
    expect(info.capabilities).toMatchObject({ resume: true, followUp: "queue", rename: false });
  });

  test("one that isn't installed or speaks another version is not offered at all", async () => {
    const missing = new AcpAdapter({ ...spec, id: "missing", executable: "velloo-no-such-agent" });
    process.env.FAKE_ACP_MODE = "v2";
    const agents = manager([adapter(), missing]);
    expect(await agents.providers(true)).toEqual([]);
    delete process.env.FAKE_ACP_MODE;
    expect((await agents.providers(true)).map((p) => p.id)).toEqual(["fake-acp"]);
    expect((await adapter().discover()).status).toBe("ready");
  });

  test("a session gets this design's MCP server over HTTP, and the canvas instructions lead the first prompt", async () => {
    const agents = manager();
    const session = await agents.start({ provider: "fake-acp" });
    expect(session.environment).toMatchObject({ cwd: dir, providerVersion: "3.2.1" });
    await agents.prompt(session.id, { text: "hello" });
    await until(() => agents.snapshot(session.id).turns[0]?.status === "completed");
    await agents.prompt(session.id, { text: "again" });
    await until(() => agents.snapshot(session.id).turns[1]?.status === "completed");
    const log = await logged();
    expect(log.find((l) => l.method === "session/new")?.params).toEqual({
      cwd: dir,
      mcpServers: [{ type: "http", name: "velloo", url: "http://127.0.0.1:9/mcp", headers: [] }],
    });
    const prompts = log
      .filter((l) => l.method === "session/prompt")
      .map((l) => l.params?.prompt as { text: string }[]);
    expect(prompts[0]?.map((b) => b.text)).toEqual(["You are in the canvas.", "hello"]);
    expect(prompts[1]?.map((b) => b.text)).toEqual(["again"]);
    const items = agents.snapshot(session.id).turns[0]?.items ?? [];
    expect(items.map((i) => i.kind)).toEqual(["user", "reasoning", "agent-text"]);
    expect(items[2]).toMatchObject({ text: "Hello there" });
    await agents.closeAll();
  });

  test("an agent without HTTP MCP gets the stdio command instead", async () => {
    process.env.FAKE_ACP_MODE = "stdio-mcp";
    const agents = manager();
    await agents.start({ provider: "fake-acp" });
    expect((await logged()).find((l) => l.method === "session/new")?.params?.mcpServers).toEqual([
      { name: "velloo", command: "velloo", args: ["mcp", "/design"], env: [] },
    ]);
    await agents.closeAll();
  });

  test("commands, Velloo calls and plans settle into the turn", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "fake-acp" });
    await agents.prompt(id, { text: "run" });
    await until(() => agents.snapshot(id).turns[0]?.status === "completed");
    const items = agents.snapshot(id).turns[0]?.items ?? [];
    expect(items.find((i) => i.kind === "command")).toMatchObject({
      command: "ls -la",
      status: "completed",
      output: "README.md",
    });
    expect(items.find((i) => i.kind === "tool")).toMatchObject({
      server: "velloo",
      name: "compose",
    });
    expect(items.find((i) => i.kind === "plan")).toMatchObject({
      steps: [{ text: "Look", status: "completed" }],
    });
    await agents.closeAll();
  });

  test("a permission request offers one-time choices only, and the answer goes back", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "fake-acp" });
    await agents.prompt(id, { text: "edit" });
    await until(() => agents.snapshot(id).approvals.length === 1);
    const [request] = agents.snapshot(id).approvals;
    expect(request).toMatchObject({
      kind: "file-change",
      paths: ["/app/a.ts"],
      decisions: ["allow-once", "deny", "abort"],
    });
    await agents.answer(id, request?.id ?? "", "deny");
    await until(() => agents.snapshot(id).turns[0]?.status === "completed");
    expect((await logged()).find((l) => l.permission)?.permission).toEqual({
      outcome: { outcome: "selected", optionId: "no" },
    });
    expect(agents.snapshot(id).turns[0]?.items.find((i) => i.kind === "file-change")).toMatchObject(
      { status: "failed" },
    );
    await agents.closeAll();
  });

  test("interrupt cancels the prompt", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "fake-acp" });
    await agents.prompt(id, { text: "long" });
    await until(() => (agents.snapshot(id).turns[0]?.items.length ?? 0) > 1);
    await agents.interrupt(id);
    await until(() => agents.snapshot(id).turns[0]?.status === "interrupted");
    expect((await logged()).some((l) => l.method === "session/cancel")).toBe(true);
    await agents.closeAll();
  });

  test("reopening loads the session and brings back what it replays", async () => {
    const agents = manager();
    const session = await agents.start({ provider: "fake-acp", resume: "s-old" });
    const turns = agents.snapshot(session.id).turns;
    expect(turns[0]?.items).toEqual([
      { kind: "user", id: "replay-0-u", text: "earlier prompt" },
      { kind: "agent-text", id: "replay-0-1", text: "earlier answer" },
    ]);
    expect((await logged()).find((l) => l.method === "session/load")?.params).toMatchObject({
      sessionId: "s-old",
    });
    await agents.closeAll();
  });

  test("a turn that ends without a reply says so instead of looking done", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "fake-acp" });
    await agents.prompt(id, { text: "silent" });
    await until(() => agents.snapshot(id).turns[0]?.status === "completed");
    expect(agents.snapshot(id).turns[0]?.items.find((i) => i.kind === "notice")).toMatchObject({
      level: "warning",
      text: "Fake ACP finished without replying. Check its model and sign-in in a terminal.",
    });
    await agents.closeAll();
  });

  test("a sign-in it needs is said in its own words", async () => {
    process.env.FAKE_ACP_MODE = "auth";
    const agents = manager();
    await expect(agents.start({ provider: "fake-acp" })).rejects.toThrow(
      "Fake ACP isn't signed in. Run `fake login`",
    );
  });

  test("a refusal, a malformed line and a crash are all reported", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "fake-acp" });
    await agents.prompt(id, { text: "refuse" });
    await until(() => agents.snapshot(id).turns[0]?.status === "failed");
    expect(agents.snapshot(id).turns[0]?.error).toContain("declined to answer");

    await agents.prompt(id, { text: "garbage" });
    await until(() => agents.snapshot(id).turns[1]?.status === "completed");
    expect(agents.snapshot(id).turns[1]?.items.some((i) => i.kind === "notice")).toBe(true);

    await agents.prompt(id, { text: "crash" });
    await until(() => agents.snapshot(id).session.state === "failed");
    expect(agents.snapshot(id).session.stateMessage).toContain("the agent fell over");
  });
});

describe("an ACP agent's slash commands", () => {
  test("its advertised commands and models are the controls, and /model uses session/set_model", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "fake-acp" });
    await until(() => (agents.snapshot(id).controls?.commands.length ?? 0) > 0);
    expect(agents.snapshot(id).controls).toMatchObject({
      commands: [
        { name: "init", description: "Set the project up", argumentHint: "[dir]" },
        { name: "review" },
      ],
      models: [
        { id: "m1", label: "Model One" },
        { id: "m2", label: "Model Two", description: "Bigger" },
      ],
      model: "m1",
    });
    expect(agents.snapshot(id).session.environment?.model).toBe("Model One");
    const session = await agents.setModel(id, "m2");
    expect(session.environment?.model).toBe("Model Two");
    expect((await logged()).find((l) => l.method === "session/set_model")?.params).toEqual({
      sessionId: "s-fake",
      modelId: "m2",
    });
    await expect(agents.mcpServers(id)).rejects.toThrow("doesn't report its MCP servers");
    await agents.closeAll();
  }, 20_000);

  test("a model or command change the agent makes on its own reaches the controls", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "fake-acp" });
    await agents.setModel(id, "m2");
    await agents.prompt(id, { text: "the model elsewhere" });
    await until(() => agents.snapshot(id).controls?.model === "m1");
    await until(() => agents.snapshot(id).controls?.commands[0]?.name === "only");
    await agents.closeAll();
  }, 20_000);

  test("its session modes switch with session/set_mode, without one that skips every check", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "fake-acp" });
    const controls = agents.snapshot(id).controls;
    expect(controls?.modes).toEqual([
      { id: "ask", label: "Ask" },
      { id: "code", label: "Code", description: "Edits without asking" },
    ]);
    expect(controls?.mode).toBe("ask");
    const session = await agents.setMode(id, "code");
    expect(session.environment?.sandbox).toBe("Code");
    expect((await logged()).find((l) => l.method === "session/set_mode")?.params).toEqual({
      sessionId: "s-fake",
      modeId: "code",
    });
    await expect(agents.setMode(id, "bypassPermissions")).rejects.toThrow("can't switch");
    await agents.closeAll();
  }, 20_000);

  test("models offered as a config option are set through it, grouped options flattened", async () => {
    process.env.FAKE_ACP_MODE = "config";
    const agents = manager();
    const { id } = await agents.start({ provider: "fake-acp" });
    expect(agents.snapshot(id).controls?.models).toEqual([
      { id: "c1", label: "C One" },
      { id: "c2", label: "C Two", description: "Hosted" },
    ]);
    expect(agents.snapshot(id).controls?.model).toBe("c1");
    expect(agents.snapshot(id).controls?.modes).toEqual([{ id: "ask", label: "Ask" }]);
    await agents.setMode(id, "ask");
    expect(
      (await logged()).filter((l) => l.method === "session/set_config_option")[0]?.params,
    ).toEqual({ sessionId: "s-fake", configId: "mode", value: "ask" });
    await agents.setModel(id, "c2");
    expect(
      (await logged()).filter((l) => l.method === "session/set_config_option")[1]?.params,
    ).toEqual({
      sessionId: "s-fake",
      configId: "model",
      value: "c2",
    });
    expect(agents.snapshot(id).controls?.model).toBe("c2");
    await agents.closeAll();
  });

  test("an agent that offers no models has no /model", async () => {
    process.env.FAKE_ACP_MODE = "stdio-mcp";
    const agents = manager();
    const { id } = await agents.start({ provider: "fake-acp" });
    expect(agents.snapshot(id).controls?.models).toEqual([]);
    await agents.closeAll();
  });

  test("a command as the first message goes ahead of the canvas instructions", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "fake-acp" });
    await agents.prompt(id, { text: "/init src" });
    await until(() => agents.snapshot(id).turns[0]?.status === "completed");
    const prompt = (await logged()).find((l) => l.method === "session/prompt")?.params?.prompt as {
      text: string;
    }[];
    expect(prompt.map((b) => b.text)).toEqual(["/init src", "You are in the canvas."]);
    await agents.closeAll();
  });

  test("a reopened session reads the models session/load returns", async () => {
    const agents = manager();
    const { id } = await agents.start({ provider: "fake-acp" });
    await agents.terminate(id);
    await agents.reopen(id);
    expect(agents.snapshot(id).controls?.model).toBe("m2");
    await agents.closeAll();
  });
});

describe("ACP normalization", () => {
  test("an edit with no old text is a new file", () => {
    expect(
      toolCallItem(
        {
          toolCallId: "x",
          kind: "edit",
          status: "completed",
          content: [{ type: "diff", path: "/n.ts", oldText: null, newText: "x" }],
        },
        "/",
      ),
    ).toEqual({
      kind: "file-change",
      id: "x",
      status: "completed",
      changes: [{ path: "/n.ts", change: "add", diff: "+x" }],
    });
  });

  test("always-allow and always-reject are never offered", () => {
    expect(
      permissionDecisions([
        { optionId: "a", kind: "allow_always" },
        { optionId: "r", kind: "reject_always" },
      ]),
    ).toEqual({ decisions: ["deny", "abort"], optionFor: {} });
  });
});

// A real ACP agent: what it advertises, a session with Velloo's MCP server,
// and a clean stop. Opt-in (`VELLOO_AGENT_LIVE=1`) because each run leaves a
// session in that agent's own history. Prompts need the agent's own model and
// sign-in, which a test can't assume; the scripted agent above covers them.
const opencode = findExecutable("opencode");
describe.skipIf(!opencode || process.env.VELLOO_AGENT_LIVE !== "1")(
  "a real ACP agent (OpenCode)",
  () => {
    const real = () => {
      const found = ACP_AGENTS.find((a) => a.id === "opencode");
      if (!found) throw new Error("OpenCode isn't in the registry");
      return new AcpAdapter(found);
    };

    test("is offered with the capabilities it advertises", async () => {
      const info = await real().discover();
      expect(info.status).toBe("ready");
      expect(info.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(info.capabilities.followUp).toBe("queue");
    }, 30_000);

    test("starts a session in the daemon's directory with Velloo's MCP server, and stops", async () => {
      const agents = manager([real()]);
      const session = await agents.start({ provider: "opencode" });
      expect(session.state).toBe("idle");
      expect(session.providerSessionId).toBeTruthy();
      expect(session.environment?.cwd).toBe(dir);
      await agents.terminate(session.id);
      expect(agents.snapshot(session.id).session.state).toBe("exited");
      expect(agents.liveCount()).toBe(0);
    }, 60_000);
  },
);
