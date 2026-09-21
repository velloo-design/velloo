import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * The shipped agent prompts are the only consumers of `get_theme`'s
 * `designSystem.path`, and nothing else would notice if a rewrite dropped it:
 * the server keeps serving the field, the agents keep working, and a folder's
 * stated design rules quietly stop being honoured or checked.
 *
 * Guards the wiring — which surface each prompt reaches for — not the prose.
 */

const AGENTS = resolve(import.meta.dir, "../../../../plugins/claude/velloo/agents");
const agent = (name: string): Promise<string> => readFile(join(AGENTS, `${name}.md`), "utf8");

describe("velloo-design-reviewer", () => {
  test("gets the document's path off get_theme and opens the file itself", async () => {
    const src = await agent("velloo-design-reviewer");
    expect(src).toContain("get_theme");
    expect(src).toContain("designSystem.path");
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
    expect(src).toContain("designSystem.path");
    expect(src).toContain("get_theme");
  });
});
