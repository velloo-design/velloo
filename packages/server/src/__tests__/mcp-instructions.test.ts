import { describe, expect, test } from "bun:test";
import { buildInstructions } from "../mcp/server.ts";

describe("buildInstructions", () => {
  test("omits the feedback paragraph when feedback is disabled", () => {
    const text = buildInstructions(false);
    expect(text).not.toContain("send_feedback");
    expect(text).not.toContain("Sending product feedback");
  });

  test("includes the feedback paragraph (with the consent rule) when enabled", () => {
    const text = buildInstructions(true);
    expect(text).toContain("send_feedback");
    expect(text).toContain("Sending product feedback");
    // The always-confirm consent rule must be present.
    expect(text).toContain("get their go-ahead before calling");
    // It must still carry the base guidance.
    expect(text).toContain("Velloo design folder");
  });
});
