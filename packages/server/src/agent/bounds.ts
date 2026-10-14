import type { AgentItem } from "@velloo/protocol/agent";

/**
 * Size limits on what a session keeps. An agent can run a test suite that
 * prints megabytes, or rewrite a generated file; the transcript keeps enough
 * to read what happened — the tail of the output, the head of a diff — and
 * says what it dropped, so neither the daemon's memory, the persisted history
 * nor the canvas's DOM grows with the provider's verbosity.
 */
export const LIMITS = {
  /** Characters of command output kept, from the end. */
  output: 32_000,
  /** Characters of one file's diff kept, from the start. */
  diff: 48_000,
  /** Characters of a turn's combined diff. */
  turnDiff: 96_000,
  /** Characters of agent text or reasoning in one item. */
  text: 200_000,
  /** Characters of a tool's rendered input or output. */
  toolText: 4_000,
  /** Turns kept per session; older ones are dropped from memory and disk. */
  turns: 200,
  /** Items kept per turn; a runaway loop keeps its first and last. */
  items: 600,
  /** Turns sent in a snapshot — the canvas asks for older ones if it wants them. */
  snapshotTurns: 60,
} as const;

/** Keep the last `max` characters, counting what was cut. */
export function tail(text: string, max: number): { text: string; dropped: number } {
  if (text.length <= max) return { text, dropped: 0 };
  return { text: text.slice(text.length - max), dropped: text.length - max };
}

/** Keep the first `max` characters. */
function head(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  return { text: text.slice(0, max), truncated: true };
}

/** A short, single-purpose rendering of a tool's arguments or result. */
function summarize(value: unknown, max: number = LIMITS.toolText): string | undefined {
  if (value === undefined || value === null) return undefined;
  let text: string;
  if (typeof value === "string") text = value;
  else {
    try {
      text = JSON.stringify(value, null, 2);
    } catch {
      text = String(value);
    }
  }
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Clamp an item's large fields to the limits, whole. */
export function boundItem(item: AgentItem): AgentItem {
  switch (item.kind) {
    case "command": {
      const kept = tail(item.output, LIMITS.output);
      if (kept.dropped === 0) return item;
      return {
        ...item,
        output: kept.text,
        outputDropped: (item.outputDropped ?? 0) + kept.dropped,
      };
    }
    case "file-change":
      return {
        ...item,
        changes: item.changes.map((change) => {
          if (change.diff === undefined) return change;
          const kept = head(change.diff, LIMITS.diff);
          return kept.truncated ? { ...change, diff: kept.text, diffTruncated: true } : change;
        }),
      };
    case "agent-text":
    case "reasoning":
    case "user":
      return item.text.length > LIMITS.text
        ? { ...item, text: item.text.slice(0, LIMITS.text) }
        : item;
    case "tool":
      return {
        ...item,
        input: item.input && summarize(item.input),
        output: item.output && summarize(item.output),
      };
    case "subagent":
    case "plan":
    case "notice":
      return item;
  }
}
