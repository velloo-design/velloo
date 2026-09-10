import { describe, expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import type { ScreenRenderFailure } from "@velloo/server";
import { formatFailures } from "../preflight-gate.ts";

const board = { id: "render-errors", name: "Render errors" };

const failures: ScreenRenderFailure[] = [
  {
    screenId: "err-several",
    screenName: "Several broken families",
    boards: [board],
    componentId: "TabsTrigger",
    reason: "`TabsTrigger` must be used within `Tabs`",
  },
  {
    screenId: "err-several",
    screenName: "Several broken families",
    boards: [board],
    componentId: "AvatarImage",
    reason: "`AvatarImage` must be used within `Avatar`",
  },
  {
    screenId: "err-uncontained",
    screenName: "Uncontained",
    boards: [board, { id: "main", name: "Main" }],
    componentId: null,
    reason: "context.values.map is not a function",
  },
  {
    screenId: "loose",
    screenName: "Loose",
    boards: [],
    componentId: "Icon",
    reason: "undefined is not an object",
  },
];

describe("formatFailures", () => {
  const text = stripVTControlCharacters(formatFailures("publish", failures).join("\n"));

  test("summarizes placeholders apart from screens that won't render", () => {
    expect(text.split("\n")[0]).toBe(
      "velloo publish: render failures on 3 screens — 3 components will appear as placeholders, and 1 screen will not render at all:",
    );
  });

  test("groups each screen under the boards that place it", () => {
    expect(text).toContain(
      "  Render errors › Several broken families (err-several)\n    TabsTrigger: `TabsTrigger` must be used within `Tabs`\n    AvatarImage:",
    );
    expect(text).toContain("  Render errors, Main › Uncontained (err-uncontained)");
    expect(text).toContain("  no board › Loose (loose)");
  });

  test("says when a whole screen failed with nothing to blame", () => {
    expect(text).toContain(
      "    screen not drawn — the error could not be pinned on one component: context.values.map is not a function",
    );
  });
});
