import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * The shipped agent prompts are the only consumers of `get_theme`'s
 * `guidance` / `guidanceRules`, and nothing else would notice if a rewrite
 * dropped them: the server keeps serving the fields, the agents keep working,
 * and a folder's stated design rules quietly stop being honoured or checked.
 *
 * Guards the wiring — which surface each prompt reaches for — not the prose.
 */

const AGENTS = resolve(import.meta.dir, "../../../../plugins/claude/velloo/agents");
const agent = (name: string): Promise<string> => readFile(join(AGENTS, `${name}.md`), "utf8");

describe("velloo-design-reviewer", () => {
  test("reads the folder's rules off get_theme", async () => {
    const src = await agent("velloo-design-reviewer");
    expect(src).toContain("get_theme");
    expect(src).toContain("guidanceRules");
  });

  test("requires findings to quote the rule verbatim", async () => {
    // The point of the dimension is that it cites the user's own words rather
    // than the agent's taste; a paraphrase makes it indistinguishable.
    expect(await agent("velloo-design-reviewer")).toContain("verbatim");
  });

  test("tells the reviewer to skip rules it cannot check instead of guessing", async () => {
    const src = await agent("velloo-design-reviewer");
    expect(src.toLowerCase()).toContain("not checked");
    expect(src.toLowerCase()).toContain("do not guess");
  });

  test("says an empty rule set is not a pass", async () => {
    const src = await agent("velloo-design-reviewer");
    expect(src).toContain("states no rules");
  });
});

describe("velloo-designer", () => {
  test("is told the rules exist, so it does not design against them", async () => {
    // Without this the loop is perverse: the designer violates rules it was
    // never shown, and the reviewer reports them every time.
    const src = await agent("velloo-designer");
    expect(src).toContain("guidanceRules");
    expect(src).toContain("get_theme");
  });
});
