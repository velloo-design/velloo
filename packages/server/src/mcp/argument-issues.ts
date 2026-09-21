import type { z } from "zod";

/**
 * Zod's `issues` are precise and unreadable: an unrecognized key doesn't say
 * what the accepted ones are, and a union failure dumps one error array per
 * branch. A model that gets one usually spends its next call on
 * `operation_schema` instead of on the correction — so every rejection also
 * carries one plain sentence saying what to change.
 */
export function summarizeIssues(
  issues: readonly z.core.$ZodIssue[],
  acceptedKeys: readonly string[],
): string | undefined {
  const lines = [...new Set(issues.map((issue) => describe(issue, acceptedKeys)).filter(Boolean))];
  if (lines.length === 0) return undefined;
  // A sentence per bad argument stops being one plain sentence somewhere around
  // the fifth; past that the raw `issues` beside it are the better read.
  const shown = lines.slice(0, MAX_LINES);
  const rest = lines.length - shown.length;
  return rest > 0 ? `${shown.join(" ")} (+${rest} more — see \`issues\`.)` : shown.join(" ");
}

const MAX_LINES = 4;

function describe(issue: z.core.$ZodIssue, acceptedKeys: readonly string[]): string {
  const at = pathOf(issue.path);
  switch (issue.code) {
    case "unrecognized_keys": {
      const keys = issue.keys;
      // `acceptedKeys` is the operation's own vocabulary, so it only answers a
      // key rejected at the top level: a typo inside a nested object (a `batch`
      // call entry) would otherwise be told to use a sibling of the object it
      // sits in — "use `atomic` instead of `atomic`".
      const nested = issue.path.length > 0;
      const suggestions = nested
        ? []
        : keys
            .map((key) => ({ key, match: closest(key, acceptedKeys) }))
            .filter((s): s is { key: string; match: string } => s.match !== undefined)
            .map((s) => `use \`${s.match}\` instead of \`${s.key}\``);
      return [
        `${plural(keys.length, "Unknown argument")} ${list(keys)}${at ? ` at ${at}` : ""}.`,
        suggestions.length > 0 ? `Did you mean: ${suggestions.join("; ")}?` : "",
        !nested && acceptedKeys.length > 0 ? `This operation accepts ${list(acceptedKeys)}.` : "",
      ]
        .filter(Boolean)
        .join(" ");
    }
    case "invalid_union": {
      // One branch's errors per entry; the shapes they expected are the useful part.
      const shapes = [...new Set(unionExpectations(issue))];
      const detail = branchDetail(issue);
      return `\`${at || "the arguments"}\` doesn't match any accepted shape — it takes ${list(
        shapes.length > 0 ? shapes : ["one of the documented shapes"],
      )}.${detail ? ` ${detail}` : ""}`;
    }
    case "invalid_type":
      return `\`${at || "the arguments"}\` expects ${issue.expected}, got ${received(issue)}.`;
    default:
      return issue.message ? `${at ? `\`${at}\`: ` : ""}${issue.message}` : "";
  }
}

/**
 * The shapes the union takes. A branch's issues are pathed relative to the
 * union, so only the ones at its own root are that branch's verdict — a deeper
 * one comes from a branch the value nearly matched, and reading it as a shape
 * reports a union of `string | object` as taking only `string`.
 */
function unionExpectations(issue: z.core.$ZodIssueInvalidUnion): string[] {
  const out: string[] = [];
  for (const branch of issue.errors) {
    for (const inner of branch) {
      if (inner.path.length > 0) continue;
      if (inner.code === "invalid_type") out.push(String(inner.expected));
      else if (inner.code === "invalid_value") out.push(...inner.values.map(String));
    }
  }
  return out;
}

/** The nearest branch the value got inside of, and what it wanted there. */
function branchDetail(issue: z.core.$ZodIssueInvalidUnion): string {
  for (const branch of issue.errors) {
    for (const inner of branch) {
      if (inner.path.length === 0) continue;
      const at = pathOf([...issue.path, ...inner.path]);
      return inner.code === "invalid_type"
        ? `The closest shape wants \`${at}\` to be ${inner.expected}, got ${received(inner)}.`
        : `The closest shape wants \`${at}\`: ${inner.message}`;
    }
  }
  return "";
}

/**
 * What actually arrived. Zod doesn't put the value on the issue (it would leak
 * the payload back), but its own message names the type — so read it there and
 * fall back to the message when a version words it differently.
 */
function received(issue: z.core.$ZodIssue): string {
  return /received (\w+)/.exec(issue.message)?.[1] ?? "something else";
}

function pathOf(path: readonly PropertyKey[]): string {
  return path.map(String).join(".");
}

function list(values: readonly string[]): string {
  const quoted = values.map((v) => `\`${v}\``);
  if (quoted.length <= 1) return quoted.join("");
  return `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}`;
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}

/**
 * The accepted key a rejected one most likely meant: a prefix/substring
 * relation (`components` → `component`, `id` → `ids`) or a single edit apart.
 * Deliberately conservative — a wrong guess costs a call.
 */
function closest(key: string, accepted: readonly string[]): string | undefined {
  const lower = key.toLowerCase();
  const contains = accepted.find((candidate) => {
    const other = candidate.toLowerCase();
    return other.includes(lower) || lower.includes(other);
  });
  if (contains) return contains;
  return accepted.find((candidate) => editDistance(lower, candidate.toLowerCase()) <= 2);
}

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 99;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length] ?? 99;
}
