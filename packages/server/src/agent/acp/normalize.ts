import type { AgentApprovalDecision, AgentItem, AgentItemStatus } from "@velloo/protocol/agent";
import { summarize } from "../bounds.ts";
import { asRecord } from "../json.ts";

/**
 * Agent Client Protocol tool calls → the agent contract. ACP types a tool call
 * by `kind` (execute, edit, read, search, …) and carries its result as content
 * blocks, so the mapping is by kind, not by a tool's name.
 */

const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

function toolStatus(value: unknown): AgentItemStatus {
  switch (value) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return "running";
  }
}

/** The text of ACP content blocks: `{type: "content", content: {type: "text"}}` and bare text blocks. */
export function contentText(raw: unknown): string {
  if (!Array.isArray(raw)) return "";
  return raw
    .map((entry) => {
      const block = asRecord(entry);
      const inner = block.type === "content" ? asRecord(block.content) : block;
      return inner.type === "text" ? (str(inner.text) ?? "") : "";
    })
    .filter(Boolean)
    .join("\n");
}

function lines(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((l) => `${prefix}${l}`)
    .join("\n");
}

/** Readable diffs from ACP's `{type: "diff", path, oldText, newText}` blocks. */
function diffChanges(
  raw: unknown,
  kind: unknown,
): Extract<AgentItem, { kind: "file-change" }>["changes"] {
  const changes: Extract<AgentItem, { kind: "file-change" }>["changes"] = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    const block = asRecord(entry);
    if (block.type !== "diff" || typeof block.path !== "string") continue;
    const before = str(block.oldText);
    const after = str(block.newText) ?? "";
    const diff =
      before === undefined ? lines(after, "+") : `@@\n${lines(before, "-")}\n${lines(after, "+")}`;
    changes.push({
      path: block.path,
      change:
        kind === "delete" ? "delete" : before === undefined || before === null ? "add" : "update",
      diff,
    });
  }
  return changes;
}

/**
 * One tool call as a transcript item. `server` names the Velloo MCP server, so
 * a call to it — which an ACP agent titles with the server's name — reads as
 * a Velloo call.
 */
export function toolCallItem(
  raw: Record<string, unknown>,
  cwd: string,
  server?: string,
): AgentItem | null {
  const id = str(raw.toolCallId);
  if (!id) return null;
  const status = toolStatus(raw.status);
  const title = str(raw.title) ?? "";
  const input = asRecord(raw.rawInput);
  const output = contentText(raw.content);
  switch (raw.kind) {
    case "execute": {
      const command = Array.isArray(input.command)
        ? input.command.join(" ")
        : (str(input.command) ?? title);
      return { kind: "command", id, command, cwd, status, output };
    }
    case "edit":
    case "delete":
    case "move": {
      const changes = diffChanges(raw.content, raw.kind);
      const locations = Array.isArray(raw.locations)
        ? raw.locations.map((l) => str(asRecord(l).path)).filter((p): p is string => !!p)
        : [];
      return {
        kind: "file-change",
        id,
        status,
        changes: changes.length
          ? changes
          : locations.map(
              (path) => ({ path, change: raw.kind === "delete" ? "delete" : "update" }) as const,
            ),
      };
    }
    default: {
      const named = server ? title.match(new RegExp(`^${server}[_.:/ ]+(.+)$`)) : null;
      const shown = summarize(raw.rawInput);
      const result = output ? summarize(output) : undefined;
      return {
        kind: "tool",
        id,
        name: named?.[1] ?? (title || String(raw.kind ?? "tool")),
        ...(named && server ? { server } : {}),
        status,
        ...(shown && shown !== "{}" ? { input: shown } : {}),
        ...(result ? { output: result } : {}),
      };
    }
  }
}

/**
 * The ACP permission options that map onto Velloo's decisions. Only the
 * one-time choices are offered: `allow_always` and `reject_always` can outlive
 * the session in the agent's own settings, which a click in the canvas
 * shouldn't grant.
 */
export function permissionDecisions(options: unknown): {
  decisions: AgentApprovalDecision[];
  optionFor: Partial<Record<AgentApprovalDecision, string>>;
} {
  const optionFor: Partial<Record<AgentApprovalDecision, string>> = {};
  for (const raw of Array.isArray(options) ? options : []) {
    const option = asRecord(raw);
    if (typeof option.optionId !== "string") continue;
    if (option.kind === "allow_once") optionFor["allow-once"] ??= option.optionId;
    if (option.kind === "reject_once") optionFor.deny ??= option.optionId;
  }
  const decisions: AgentApprovalDecision[] = [
    ...(optionFor["allow-once"] ? (["allow-once"] as const) : []),
    "deny",
    "abort",
  ];
  return { decisions, optionFor };
}
