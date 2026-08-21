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

  test("surfaces the live canvas URL when one is given (stdio binds an ephemeral port)", () => {
    const text = buildInstructions(false, "http://127.0.0.1:54321");
    expect(text).toContain("http://127.0.0.1:54321");
    expect(text).toContain("give the user this URL");
  });

  test("omits the canvas-URL line when no URL is given", () => {
    expect(buildInstructions(false)).not.toContain("give the user this URL");
  });

  test("a MUI (sx) folder is framed for Material UI, not shadcn/Tailwind", () => {
    const mui = buildInstructions(false, undefined, false, "sx");
    expect(mui).toContain("Material UI");
    expect(mui).toContain("Style with the `sx` object");
    // It tells the agent the Tailwind guidance below doesn't apply here.
    expect(mui).toContain("does NOT apply here");
    // The MUI frame leads (before the shadcn-tuned base parts).
    expect(mui.indexOf("Material UI")).toBeLessThan(mui.indexOf("pinned shadcn snapshot"));
  });

  test("a shadcn (tailwind) folder keeps the default Tailwind-shaped framing", () => {
    const shadcn = buildInstructions(false, undefined, false, "tailwind-classname", "shadcn-react");
    expect(shadcn).not.toContain("Style with the `sx` object");
    // No framework-specific intro prepended — the default opening leads.
    expect(shadcn).not.toContain("**no-framework** Velloo design folder");
    expect(shadcn).toContain("pinned shadcn snapshot");
  });

  test("a no-framework folder is framed as bare primitives, correcting the shadcn claim", () => {
    const none = buildInstructions(false, undefined, false, "tailwind-classname", "none");
    expect(none).toContain("no-framework");
    expect(none).toContain("NO shadcn surface");
    // Still Tailwind-shaped (no sx), and the correction leads.
    expect(none).not.toContain("Style with the `sx` object");
    expect(none.indexOf("no-framework")).toBeLessThan(none.indexOf("pinned shadcn snapshot"));
  });
});
