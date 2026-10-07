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
  operation?: string,
  args?: Record<string, unknown>,
): string | undefined {
  const lines = [
    ...new Set(
      issues.map((issue) => describe(issue, acceptedKeys, operation, args)).filter(Boolean),
    ),
  ];
  if (lines.length === 0) return undefined;
  // A sentence per bad argument stops being one plain sentence somewhere around
  // the fifth; past that the raw `issues` beside it are the better read.
  const shown = lines.slice(0, MAX_LINES);
  const rest = lines.length - shown.length;
  return rest > 0 ? `${shown.join(" ")} (+${rest} more — see \`issues\`.)` : shown.join(" ");
}

const MAX_LINES = 4;

/**
 * Arguments agents reach for on the wrong operation, with where they belong.
 * Spelling distance cannot find these — `url` is nothing like `source` — and
 * each one cost an eval run a call plus a schema lookup to work out.
 */
const MISPLACED: Record<string, Record<string, string>> = {
  compare_to_url: {
    url: "the live page goes in `source: { url }`, beside the `screenId` it is compared with",
  },
  screenshot: {
    url: "`screenshot` renders a design screen; to look at a live page, `compare_to_url { screenId, source: { url } }` returns it beside the screen",
  },
  find_nodes: {
    query: "to match a node's text, use `text`",
  },
  component_status: {
    components: "component ids go in `ids`",
  },
  import_theme: {
    url: "`import_theme` reads a stylesheet from disk and cannot fetch a page; pass the app's CSS file as `cssPath`",
  },
  update_props: {
    path: "edits go in `patches: [{ path, propPatch, style }]`, one entry per node",
    props: "a node's prop changes are its patch's `propPatch`, in `patches: [{ path, propPatch }]`",
  },
};

function describe(
  issue: z.core.$ZodIssue,
  acceptedKeys: readonly string[],
  operation: string | undefined,
  args: Record<string, unknown> | undefined,
): string {
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
        : keys.flatMap((key) => {
            const matches = readings(key, acceptedKeys, args?.[key]).slice(0, 3);
            return matches.length > 0
              ? [`use ${matches.map((m) => `\`${m}\``).join(" or ")} instead of \`${key}\``]
              : [];
          });
      const misplaced = nested
        ? []
        : keys.flatMap((key) => {
            const hint = operation ? MISPLACED[operation]?.[key] : undefined;
            return hint ? [`\`${key}\`: ${hint}.`] : [];
          });
      return [
        `${plural(keys.length, "Unknown argument")} ${list(keys)}${at ? ` at ${at}` : ""}.`,
        ...misplaced,
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
 * Top-level keys the operation doesn't take, each paired with the one accepted
 * key it can only have meant (`screen` → `screenId`) when that key is absent.
 * Empty unless every rejected key has exactly one such reading — a guess
 * between two accepted keys is left to the caller.
 */
export function unambiguousRenames(
  issues: readonly z.core.$ZodIssue[],
  acceptedKeys: readonly string[],
  args: Record<string, unknown>,
): Record<string, string> {
  const unknown = issues.flatMap((issue) =>
    issue.code === "unrecognized_keys" && issue.path.length === 0 ? issue.keys : [],
  );
  const renames: Record<string, string> = {};
  for (const key of unknown) {
    const matches = readings(key, acceptedKeys, args[key]);
    const [only] = matches;
    if (matches.length !== 1 || only === undefined) return {};
    // Both names with one value (`id` beside the same `snippetId`) say one
    // thing twice; two values are a real conflict and stay the caller's.
    if (only in args && args[only] !== args[key]) return {};
    if (Object.values(renames).includes(only)) return {};
    renames[key] = only;
  }
  return renames;
}

/**
 * Generic words for an argument that the operation names more specifically:
 * `path` on an operation that takes `cssPath` and `designMdPath`. Spelling
 * finds most of these; the ones it can't (`stylesheet`, `href`) are listed.
 * The last three run the other way — the operation's name is the generic one:
 * `component_status` takes `ids` and `find_nodes` takes `ref`, and agents name
 * what those are of; `set_preview_entry` takes `source`, and agents name what
 * it holds.
 */
const ALIASES: { words: RegExp; key: RegExp }[] = [
  { words: /^(?:path|file|filepath|filename|src|source)$/i, key: /path$/i },
  { words: /^(?:url|href|link|uri)$/i, key: /url$/i },
  { words: /^(?:stylesheet|styles?|cssfile)$/i, key: /css/i },
  { words: /^(?:components?|componentids?)$/i, key: /^ids$/i },
  { words: /^(?:component|componentname|tag)$/i, key: /^ref$/i },
  { words: /^(?:code|content|contents|tsx|jsx)$/i, key: /^source$/i },
];

/**
 * What a string value says about the argument it belongs in — a path ending
 * `.css` is the stylesheet, whatever the key was called. This is what tells
 * `cssPath` from `designMdPath` when the agent wrote `path`.
 */
const VALUE_HINTS: { value: RegExp; key: RegExp }[] = [
  { value: /tailwind\.config\.[cm]?[jt]s$/i, key: /tailwind/i },
  { value: /\.(?:css|scss|sass|less)$/i, key: /css/i },
  { value: /\.(?:md|mdx|markdown)$/i, key: /md|markdown/i },
  { value: /^https?:\/\//i, key: /url/i },
];

/**
 * The accepted keys a rejected one could mean, likeliest first: a
 * prefix/substring relation (`components` → `component`, `id` → `ids`), a
 * generic alias, or a single edit apart — narrowed by what the value looks
 * like when that settles it. Deliberately conservative — a wrong guess costs a
 * call.
 */
function readings(key: string, accepted: readonly string[], value: unknown): string[] {
  const lower = key.toLowerCase();
  const contains = accepted.filter((candidate) => {
    const other = candidate.toLowerCase();
    return other.includes(lower) || lower.includes(other);
  });
  const aliased = ALIASES.filter((alias) => alias.words.test(key)).flatMap((alias) =>
    accepted.filter((candidate) => alias.key.test(candidate)),
  );
  const near = accepted.filter((candidate) => editDistance(lower, candidate.toLowerCase()) <= 2);
  const all = [...new Set([...contains, ...aliased, ...near])];
  if (typeof value !== "string") return all;
  const hint = VALUE_HINTS.find((h) => h.value.test(value.trim()));
  const fitting = hint ? all.filter((candidate) => hint.key.test(candidate)) : [];
  const narrowed = fitting.length > 0 ? fitting : all;
  // A one-word value with an extension is a file's name, not its contents:
  // `src/index.css` is `cssPath`, not `css`.
  const paths = /^[^\s]+\.\w+$/.test(value.trim())
    ? narrowed.filter((candidate) => /path$/i.test(candidate))
    : [];
  return paths.length > 0 ? paths : narrowed;
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
