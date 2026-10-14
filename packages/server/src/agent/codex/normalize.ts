import type { AgentItem, AgentItemStatus, AgentTurn } from "@velloo/protocol/agent";
import { summarize } from "../bounds.ts";
import { asRecord } from "../json.ts";

/**
 * Codex app-server shapes → the agent contract. Reads only the fields it
 * renders, defensively: a field a newer Codex renamed degrades to a blank,
 * never to a crash, and a whole item kind Velloo doesn't know is skipped.
 */

const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
const num = (value: unknown): number | undefined => (typeof value === "number" ? value : undefined);

function itemStatus(value: unknown, exitCode?: number | null): AgentItemStatus {
  switch (value) {
    case "inProgress":
      return "running";
    case "failed":
    case "interrupted":
      return "failed";
    case "declined":
      return "declined";
    default:
      return exitCode !== undefined && exitCode !== null && exitCode !== 0 ? "failed" : "completed";
  }
}

/**
 * The command a person would have typed. Codex runs everything through the
 * login shell (`/bin/zsh -lc 'npm test'`); the wrapper is noise in a transcript.
 */
export function displayCommand(command: string): string {
  const match = command.match(/^\S*\/(?:ba|z|fi)?sh -l?c (.+)$/s);
  if (!match?.[1]) return command;
  const inner = match[1].trim();
  const quoted = inner.match(/^'(.*)'$/s) ?? inner.match(/^"(.*)"$/s);
  return quoted?.[1] ?? inner;
}

/** The text of an MCP tool result's content blocks. */
function mcpResultText(result: unknown): string | undefined {
  const content = asRecord(result).content;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .map((block) => str(asRecord(block).text))
    .filter((t): t is string => !!t)
    .join("\n");
  return text || undefined;
}

/** One ThreadItem as a transcript item, or null for a kind that isn't shown. */
export function normalizeItem(raw: unknown, { includeUser = false } = {}): AgentItem | null {
  const item = asRecord(raw);
  const id = str(item.id);
  if (!id) return null;
  switch (item.type) {
    case "userMessage": {
      if (!includeUser) return null;
      const content = Array.isArray(item.content) ? item.content : [];
      const text = content
        .map((c) => str(asRecord(c).text))
        .filter((t): t is string => t !== undefined)
        .join("\n");
      return { kind: "user", id, text };
    }
    case "agentMessage": {
      const phase =
        item.phase === "final_answer"
          ? "final"
          : item.phase === "commentary"
            ? "commentary"
            : undefined;
      return { kind: "agent-text", id, text: str(item.text) ?? "", ...(phase ? { phase } : {}) };
    }
    case "plan":
      return { kind: "agent-text", id, text: str(item.text) ?? "" };
    case "reasoning": {
      const summary = Array.isArray(item.summary)
        ? item.summary.filter((s) => typeof s === "string")
        : [];
      return { kind: "reasoning", id, text: summary.join("\n\n") };
    }
    case "commandExecution": {
      const exitCode = num(item.exitCode) ?? null;
      const durationMs = num(item.durationMs);
      const cwd = str(item.cwd);
      return {
        kind: "command",
        id,
        command: displayCommand(str(item.command) ?? ""),
        ...(cwd ? { cwd } : {}),
        status: itemStatus(item.status, exitCode),
        output: str(item.aggregatedOutput) ?? "",
        exitCode,
        ...(durationMs !== undefined ? { durationMs } : {}),
      };
    }
    case "fileChange":
      return {
        kind: "file-change",
        id,
        status: itemStatus(item.status),
        changes: fileChanges(item.changes),
      };
    case "mcpToolCall": {
      const server = str(item.server);
      const error = str(asRecord(item.error).message);
      const input = summarize(item.arguments);
      const output = error ?? mcpResultText(item.result);
      return {
        kind: "tool",
        id,
        name: str(item.tool) ?? "tool",
        ...(server ? { server } : {}),
        status: error ? "failed" : itemStatus(item.status),
        ...(input ? { input } : {}),
        ...(output ? { output } : {}),
      };
    }
    case "dynamicToolCall": {
      const input = summarize(item.arguments);
      return {
        kind: "tool",
        id,
        name: str(item.tool) ?? "tool",
        status: item.success === false ? "failed" : itemStatus(item.status),
        ...(input ? { input } : {}),
      };
    }
    case "webSearch": {
      const query = str(item.query);
      return {
        kind: "tool",
        id,
        name: "Web search",
        status: "completed",
        ...(query ? { input: query } : {}),
      };
    }
    case "imageView": {
      const path = str(item.path);
      return {
        kind: "tool",
        id,
        name: "View image",
        status: "completed",
        ...(path ? { input: path } : {}),
      };
    }
    case "collabAgentToolCall":
      return {
        kind: "subagent",
        id,
        description: str(item.prompt) ?? str(item.tool) ?? "Subagent",
        status: itemStatus(item.status),
      };
    case "contextCompaction":
      return {
        kind: "notice",
        id,
        level: "info",
        text: "Codex compacted the conversation to fit its context.",
      };
    case "enteredReviewMode":
      return { kind: "notice", id, level: "info", text: "Started a review." };
    case "exitedReviewMode":
      return { kind: "notice", id, level: "info", text: "Finished the review." };
    default:
      return null;
  }
}

export function fileChanges(raw: unknown): Extract<AgentItem, { kind: "file-change" }>["changes"] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const change = asRecord(entry);
    const path = str(change.path);
    if (!path) return [];
    const kind = asRecord(change.kind).type;
    const diff = str(change.diff);
    return [
      {
        path,
        change: kind === "add" ? "add" : kind === "delete" ? "delete" : "update",
        ...(diff ? { diff } : {}),
      } as const,
    ];
  });
}

export function turnStatus(value: unknown): AgentTurn["status"] {
  return value === "completed" || value === "interrupted" || value === "failed" ? value : "running";
}

const iso = (seconds: unknown) =>
  typeof seconds === "number" ? new Date(seconds * 1000).toISOString() : new Date().toISOString();

/** A resumed thread's turns, for the transcript of a session reopened from Codex's store. */
export function normalizeTurns(raw: unknown): AgentTurn[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const turn = asRecord(entry);
    const id = str(turn.id);
    if (!id) return [];
    const items = Array.isArray(turn.items)
      ? turn.items
          .map((item) => normalizeItem(item, { includeUser: true }))
          .filter((i): i is AgentItem => i !== null)
      : [];
    const error = str(asRecord(turn.error).message);
    const status = turnStatus(turn.status);
    return [
      {
        id,
        // A turn that was still running when its process died is not running now.
        status: status === "running" ? "interrupted" : status,
        items,
        ...(error ? { error } : {}),
        startedAt: iso(turn.startedAt),
        ...(turn.completedAt ? { completedAt: iso(turn.completedAt) } : {}),
      },
    ];
  });
}

/** Codex's sandbox policy, in the words its own config uses. */
export function sandboxLabel(raw: unknown): string {
  switch (asRecord(raw).type) {
    case "dangerFullAccess":
      return "danger-full-access";
    case "readOnly":
      return "read-only";
    case "workspaceWrite":
      return "workspace-write";
    case "externalSandbox":
      return "external-sandbox";
    default:
      return typeof raw === "string" ? raw : "unknown";
  }
}

export function approvalLabel(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (asRecord(raw).granular) return "granular";
  return "unknown";
}
