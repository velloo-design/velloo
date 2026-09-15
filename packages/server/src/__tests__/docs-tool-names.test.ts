import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { TOOL_ANNOTATIONS } from "../mcp/tool-policy.ts";

/**
 * The prose that teaches agents the MCP surface — the reference doc, the
 * shipped skills, the plugin agents and commands — is not compiled, so a tool
 * that is removed or renamed keeps being recommended there until a session
 * calls it and fails. `tool-policy.test.ts` pins the registered set; this pins
 * the prose to it.
 */

const REPO = resolve(import.meta.dir, "../../../..");

/**
 * Tools that used to exist, and the lower-level tree encodings the MCP surface
 * no longer exposes (`compose` lowers onto them; they stay on the HTTP API).
 * A match in agent-facing prose is a recommendation to call a tool that fails.
 */
const RETIRED = [
  "audit",
  "list_snippets",
  "install_component",
  "validate_classes",
  "inspect_dark_diff",
  "apply_classes",
  "apply_preset",
  "set_typeset",
  "pull_comments",
  "add_node",
  "instantiate_snippet",
  "set_screen_tree",
];

function filesUnder(dir: string, keep: (path: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path, keep));
    else if (keep(path)) out.push(path);
  }
  return out;
}

/** First-column tool names of every markdown table whose header starts `| Tool |`. */
function tableToolNames(markdown: string): string[] {
  const names: string[] = [];
  let inToolTable = false;
  for (const line of markdown.split("\n")) {
    if (!line.startsWith("|")) {
      inToolTable = false;
      continue;
    }
    if (/^\|\s*Tool\s*\|/.test(line)) {
      inToolTable = true;
      continue;
    }
    if (!inToolTable || /^\|\s*-/.test(line)) continue;
    const cell = line.split("|")[1] ?? "";
    const name = /^\s*`([a-z_]+)`\s*$/.exec(cell)?.[1];
    if (name) names.push(name);
    else throw new Error(`Unparseable tool-table row in docs/mcp.md: ${line}`);
  }
  return names;
}

/** Backticked spans that name `tool` as the call itself: `tool` or `tool { … }`. */
function retiredMentions(text: string): string[] {
  const found = new Set<string>();
  for (const span of text.matchAll(/`([^`\n]+)`/g)) {
    const head = /^(?:mcp__velloo__)?([a-z_]+)(?:\s|\(|$)/.exec(span[1] ?? "")?.[1];
    if (head && RETIRED.includes(head)) found.add(head);
  }
  return [...found];
}

describe("agent-facing docs name only registered tools", () => {
  const registered = new Set(Object.keys(TOOL_ANNOTATIONS));

  test("the retired list names no tool that is registered", () => {
    expect(RETIRED.filter((name) => registered.has(name))).toEqual([]);
  });

  test("every docs/mcp.md tool-table row is a registered tool", () => {
    const names = tableToolNames(readFileSync(join(REPO, "docs/mcp.md"), "utf8"));
    expect(names.length).toBeGreaterThan(50);
    expect(names.filter((name) => !registered.has(name))).toEqual([]);
  });

  test("every registered tool has a docs/mcp.md table row", () => {
    const names = new Set(tableToolNames(readFileSync(join(REPO, "docs/mcp.md"), "utf8")));
    expect([...registered].filter((name) => !names.has(name))).toEqual([]);
  });

  test("skills, plugins and the architecture doc recommend no retired tool", () => {
    const files = [
      ...filesUnder(join(REPO, "skills"), (path) => path.endsWith(".md")),
      ...filesUnder(join(REPO, "plugins"), (path) => /\.(md|toml|json)$/.test(path)),
      join(REPO, "docs/architecture.md"),
    ];
    expect(files.length).toBeGreaterThan(5);
    const offenders = files.flatMap((path) =>
      retiredMentions(readFileSync(path, "utf8")).map((name) => `${relative(REPO, path)}: ${name}`),
    );
    expect(offenders).toEqual([]);
  });
});
