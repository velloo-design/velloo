import { describe, expect, test } from "bun:test";
import { boundItem, LIMITS, summarize } from "../agent/bounds.ts";

describe("what a session keeps of large output", () => {
  test("a summary is short, and copes with what can't be serialized", () => {
    expect(summarize(undefined)).toBeUndefined();
    expect(summarize("x".repeat(LIMITS.toolText + 10))).toHaveLength(LIMITS.toolText + 1);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(summarize(circular)).toBe("[object Object]");
  });

  test("a diff keeps its head and says it was cut", () => {
    const item = boundItem({
      kind: "file-change",
      id: "f",
      status: "completed",
      changes: [
        { path: "big.ts", change: "update", diff: "+".repeat(LIMITS.diff + 5) },
        { path: "small.ts", change: "add" },
      ],
    });
    expect(item.kind === "file-change" && item.changes[0]).toMatchObject({ diffTruncated: true });
    expect(item.kind === "file-change" && item.changes[0]?.diff?.length).toBe(LIMITS.diff);
    expect(item.kind === "file-change" && item.changes[1]).toEqual({
      path: "small.ts",
      change: "add",
    });
  });

  test("text, tool output and short commands are kept within their limits", () => {
    const text = boundItem({ kind: "agent-text", id: "a", text: "y".repeat(LIMITS.text + 1) });
    expect(text.kind === "agent-text" && text.text.length).toBe(LIMITS.text);
    const tool = boundItem({
      kind: "tool",
      id: "t",
      name: "x",
      status: "completed",
      output: "z".repeat(LIMITS.toolText * 2),
    });
    expect(tool.kind === "tool" && tool.output?.length).toBe(LIMITS.toolText + 1);
    const command = {
      kind: "command" as const,
      id: "c",
      command: "ls",
      status: "completed" as const,
      output: "ok",
    };
    expect(boundItem(command)).toBe(command);
  });
});
