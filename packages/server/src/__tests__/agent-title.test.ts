import { describe, expect, test } from "bun:test";
import { sessionTitle } from "../agent/title.ts";

describe("a session's title from its first prompt", () => {
  test.each([
    ["**Reviews**", "Reviews"],
    ["Fix the __hero__ and *nav*, ~~not~~ the _footer_", "Fix the hero and nav, not the footer"],
    ["Use `Field` for the ``a ` b`` input", "Use Field for the a ` b input"],
    ["See [the spec](https://example.com/spec) and ![logo](a.png)", "See the spec and logo"],
    ["Read <https://example.com> and [ref][1]", "Read https://example.com and ref"],
    ["## Reviews ##", "Reviews"],
    ["> quoted **ask**", "quoted ask"],
    ["- [x] make it **bold**", "make it bold"],
    ["3. third step", "third step"],
    ["  spaced \t  out   words  ", "spaced out words"],
    ["keep snake_case and 2 * 3 * 4 as they are", "keep snake_case and 2 * 3 * 4 as they are"],
    ["escaped \\*stars\\*", "escaped *stars*"],
    ["`**not emphasis**` here", "**not emphasis** here"],
  ])("%j reads as %j", (prompt, title) => {
    expect(sessionTitle(prompt)).toBe(title);
  });

  test("the first line that says something names it; a code block is skipped unless it's all there is", () => {
    expect(sessionTitle("\n\n---\n**Reviews**\nand more")).toBe("Reviews");
    expect(sessionTitle("```ts\nconst a = 1;\n```\nWhy does this fail?")).toBe(
      "Why does this fail?",
    );
    expect(sessionTitle("```\nnpm   run build\n```")).toBe("npm run build");
    expect(sessionTitle("#\n- \nReal words")).toBe("Real words");
  });

  test("a long one is cut to fit a row, after the Markdown is gone", () => {
    const title = sessionTitle(`**${"word ".repeat(30).trim()}**`);
    expect(title).toHaveLength(60);
    expect(title.endsWith("…")).toBe(true);
    expect(title).not.toContain("*");
  });
});
