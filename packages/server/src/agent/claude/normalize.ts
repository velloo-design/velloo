import type {
  AgentAnswers,
  AgentApprovalRequest,
  AgentItem,
  AgentItemStatus,
  AgentQuestion,
} from "@velloo/protocol/agent";
import { summarize } from "../bounds.ts";
import { asRecord } from "../json.ts";

/**
 * Claude Code's tools → the agent contract. Its tools are named, not typed, so
 * the mapping is by name: the built-ins a person recognises become commands,
 * file changes, subagents and plans, and everything else — an MCP tool, a web
 * fetch — is a tool call with a short rendering of its arguments.
 */

const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

const FILE_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
const SUBAGENT_TOOLS = new Set(["Task", "Agent"]);

/** `mcp__velloo__compose` → `{ server: "velloo", name: "compose" }`. */
export function mcpTool(name: string): { server: string; name: string } | null {
  const match = name.match(/^mcp__(.+?)__(.+)$/);
  return match?.[1] && match[2] ? { server: match[1], name: match[2] } : null;
}

/** The one argument that says what a tool call is about, when there is one. */
function headline(name: string, input: Record<string, unknown>): string | undefined {
  switch (name) {
    case "Read":
    case "NotebookRead":
      return str(input.file_path) ?? str(input.notebook_path);
    case "Grep":
    case "Glob":
      return [str(input.pattern), str(input.path)].filter(Boolean).join(" in ");
    case "WebFetch":
      return str(input.url);
    case "WebSearch":
      return str(input.query);
    default:
      return undefined;
  }
}

function lines(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

/** A diff a person can read, from an Edit's before and after. */
function editDiff(input: Record<string, unknown>): string | undefined {
  const edits = Array.isArray(input.edits) ? input.edits.map(asRecord) : [input];
  const hunks = edits.flatMap((edit) => {
    const before = str(edit.old_string);
    const after = str(edit.new_string);
    if (before === undefined || after === undefined) return [];
    return [`@@\n${lines(before, "-")}\n${lines(after, "+")}`];
  });
  return hunks.length ? hunks.join("\n") : undefined;
}

/** A tool call as a transcript item, before its result is known. */
export function toolUseItem(id: string, name: string, rawInput: unknown, cwd: string): AgentItem {
  const input = asRecord(rawInput);
  if (name === "Bash") {
    return {
      kind: "command",
      id,
      command: str(input.command) ?? "",
      cwd,
      status: "running",
      output: "",
    };
  }
  if (FILE_TOOLS.has(name)) {
    const path = str(input.file_path) ?? str(input.notebook_path) ?? "";
    const diff =
      name === "Write"
        ? str(input.content)
          ? lines(str(input.content) ?? "", "+")
          : undefined
        : editDiff(input);
    return {
      kind: "file-change",
      id,
      status: "running",
      changes: [{ path, change: "update", ...(diff ? { diff } : {}) }],
    };
  }
  if (SUBAGENT_TOOLS.has(name)) {
    return {
      kind: "subagent",
      id,
      description: str(input.description) ?? str(input.prompt)?.split("\n")[0] ?? "Subagent",
      status: "running",
    };
  }
  if (name === "TodoWrite" && Array.isArray(input.todos)) {
    return {
      kind: "plan",
      id,
      steps: input.todos.map((raw) => {
        const todo = asRecord(raw);
        const status =
          todo.status === "completed"
            ? "completed"
            : todo.status === "in_progress"
              ? "in-progress"
              : "pending";
        return { text: str(todo.content) ?? "", status };
      }),
    };
  }
  const mcp = mcpTool(name);
  const shown = headline(name, input) ?? summarize(input);
  return {
    kind: "tool",
    id,
    name: mcp?.name ?? name,
    ...(mcp ? { server: mcp.server } : {}),
    status: "running",
    ...(shown ? { input: shown } : {}),
  };
}

/** The text of a tool result's content, which is a string or a list of blocks. */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => str(asRecord(block).text))
    .filter((t): t is string => t !== undefined)
    .join("\n");
}

/**
 * Settle a tool item with its result. `structured` is Claude Code's own
 * `tool_use_result`, which carries a Bash command's clean stdout/stderr and
 * whether a Write created the file.
 */
export function withResult(
  item: AgentItem,
  content: unknown,
  isError: boolean,
  structured: unknown,
): AgentItem {
  const status: AgentItemStatus = isError ? "failed" : "completed";
  const text = resultText(content);
  const extra = asRecord(structured);
  switch (item.kind) {
    case "command": {
      const out = [str(extra.stdout), str(extra.stderr)].filter((s) => s).join("\n");
      return {
        ...item,
        status,
        output: out || text,
      };
    }
    case "file-change":
      return {
        ...item,
        status,
        changes: item.changes.map((c) =>
          extra.type === "create" ? { ...c, change: "add" as const } : c,
        ),
      };
    case "subagent":
      return { ...item, status };
    case "tool": {
      const output = summarize(text);
      return { ...item, status, ...(output ? { output } : {}) };
    }
    default:
      return item;
  }
}

const SAVED_IN: Record<string, string> = {
  localSettings: "in this project, for you only (.claude/settings.local.json)",
  projectSettings: "in this project (.claude/settings.json)",
  userSettings: "in all your projects (~/.claude/settings.json)",
};

/** A rule as Claude Code's own prompt names it: `Bash(npm test)`, `velloo · read_velloo`. */
function ruleLabel(rule: Record<string, unknown>): string | undefined {
  const tool = str(rule.toolName);
  if (!tool) return undefined;
  const mcp = mcpTool(tool);
  const name = mcp ? `${mcp.server} · ${mcp.name}` : tool;
  const content = str(rule.ruleContent);
  return content ? `${name}(${content})` : name;
}

/**
 * What the two "allow and stop asking" answers carry back, from the updates
 * Claude Code proposed with a prompt. It proposes the tool's own rule for a
 * settings file — what its terminal's "don't ask again" saves — and only the
 * incidentals for the session, so "for this session" takes every proposal
 * scoped to the session, and "always" takes them as proposed.
 */
export function permissionChoices(suggestions: unknown[]): {
  session: Record<string, unknown>[];
  saved: Record<string, unknown>[];
  always?: string;
} {
  const allowing = suggestions
    .map(asRecord)
    .filter((s) => s.behavior === undefined || s.behavior === "allow");
  const session = allowing.map((s) => ({ ...s, destination: "session" }));
  const persistent = allowing.filter(
    (s) => typeof s.destination === "string" && s.destination in SAVED_IN,
  );
  const first = persistent[0];
  if (!first) return { session, saved: [] };
  const rules = persistent
    .filter((s) => s.type === "addRules" && s.destination === first.destination)
    .flatMap((s) => (Array.isArray(s.rules) ? s.rules.map(asRecord) : []))
    .map(ruleLabel)
    .filter((label): label is string => label !== undefined);
  const what = rules.length > 0 ? rules.join(", ") : "this";
  return {
    session,
    saved: allowing,
    always: `Don't ask again for ${what} ${SAVED_IN[String(first.destination)]}.`,
  };
}

/**
 * AskUserQuestion's questions. Claude Code keys the answers by the question's
 * text and always takes an answer in the person's own words.
 */
function askedQuestions(input: Record<string, unknown>): AgentQuestion[] {
  const questions = Array.isArray(input.questions) ? input.questions.map(asRecord) : [];
  return questions.flatMap((q) => {
    const question = str(q.question);
    if (!question) return [];
    const header = str(q.header);
    const options = (Array.isArray(q.options) ? q.options.map(asRecord) : []).flatMap((o) => {
      const label = str(o.label);
      const description = str(o.description);
      return label ? [{ label, ...(description ? { description } : {}) }] : [];
    });
    return [
      {
        id: question,
        question,
        ...(header ? { header } : {}),
        options,
        ...(q.multiSelect === true ? { multiSelect: true } : {}),
        other: true,
      },
    ];
  });
}

/** AskUserQuestion's input with the person's answers in it, as Claude Code's own prompt returns it. */
export function answeredInput(
  input: Record<string, unknown>,
  answers: AgentAnswers,
): Record<string, unknown> {
  return {
    ...input,
    answers: Object.fromEntries(
      Object.entries(answers).map(([question, picked]) => [question, picked.join(", ")]),
    ),
  };
}

/** A permission prompt from Claude Code, as an approval request. */
export function approvalFor(
  request: Record<string, unknown>,
  cwd: string,
  choices: { session: boolean; always?: string | undefined },
): Omit<AgentApprovalRequest, "id"> {
  const tool = str(request.tool_name) ?? "a tool";
  const input = asRecord(request.input);
  const reason = str(request.decision_reason) ?? str(request.reason);
  const decisions: AgentApprovalRequest["decisions"] = [
    "allow-once",
    ...(choices.session ? (["allow-session"] as const) : []),
    ...(choices.always ? (["allow-always"] as const) : []),
    "deny",
    "abort",
  ];
  const base = {
    ...(typeof request.tool_use_id === "string" ? { itemId: request.tool_use_id } : {}),
    ...(reason ? { reason } : {}),
    tool,
    cwd,
    decisions,
    ...(choices.always && tool !== "AskUserQuestion" ? { always: choices.always } : {}),
    requestedAt: new Date().toISOString(),
  };
  if (tool === "Bash") {
    const description = str(input.description);
    return {
      ...base,
      kind: "command",
      title: "Run a command",
      command: str(input.command) ?? "",
      ...(description && !reason ? { reason: description } : {}),
    };
  }
  if (FILE_TOOLS.has(tool)) {
    const path = str(input.file_path) ?? str(input.notebook_path);
    return {
      ...base,
      kind: "file-change",
      title: tool === "Write" ? "Write a file" : "Edit a file",
      ...(path ? { paths: [path] } : {}),
    };
  }
  if (tool === "AskUserQuestion") {
    const questions = askedQuestions(input);
    return {
      ...base,
      kind: "question",
      title: questions[0]?.question ?? "Claude has a question",
      ...(questions.length ? { questions } : {}),
      decisions: questions.length ? ["allow-once", "deny"] : ["deny"],
    };
  }
  if (tool === "ExitPlanMode") {
    const plan = str(input.plan);
    return {
      ...base,
      kind: "tool",
      title: "Approve the plan and start",
      ...(plan ? { input: summarize(plan) } : {}),
    };
  }
  const mcp = mcpTool(tool);
  const shown = summarize(input);
  return {
    ...base,
    kind: "tool",
    title: mcp ? `Use ${mcp.server} · ${mcp.name}` : `Use ${str(request.display_name) ?? tool}`,
    ...(shown ? { input: shown } : {}),
  };
}
