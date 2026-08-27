import { describe, expect, test } from "bun:test";
import { createProvider as createAntdProvider } from "@velloo/provider-antd";
import { createProvider as createMuiProvider } from "@velloo/provider-mui";
import { createProvider as createNoneProvider } from "@velloo/provider-none";
import { buildInstructions } from "../mcp/server.ts";

/** Resolve an adapter's intro the way buildMcpServer does. */
const introOf = (
  p: ReturnType<typeof createMuiProvider>,
  channel: "sx" | "tailwind-classname" | "style",
): readonly string[] => p.mcpIntro?.(channel) ?? [];

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
    const mui = buildInstructions(false, undefined, false, introOf(createMuiProvider(), "sx"));
    expect(mui).toContain("Material UI");
    expect(mui).toContain("Style with the `sx` object");
    // It tells the agent the Tailwind guidance below doesn't apply here.
    expect(mui).toContain("does NOT apply here");
    // The MUI frame leads (before the shadcn-tuned base parts).
    expect(mui.indexOf("Material UI")).toBeLessThan(mui.indexOf("pinned shadcn snapshot"));
  });

  test("an antd (style) folder is framed for Ant Design + inline styles, not shadcn/Tailwind", () => {
    const antd = buildInstructions(false, undefined, false, introOf(createAntdProvider(), "style"));
    expect(antd).toContain("Ant Design");
    expect(antd).toContain("Style with the inline `style` object");
    // It tells the agent the Tailwind guidance below doesn't apply here.
    expect(antd).toContain("does NOT apply here");
    // The antd frame leads (before the shadcn-tuned base parts).
    expect(antd.indexOf("Ant Design")).toBeLessThan(antd.indexOf("pinned shadcn snapshot"));
  });

  test("a shadcn (tailwind) folder keeps the default Tailwind-shaped framing", () => {
    // shadcn-upstream declares no mcpIntro — the default framing leads.
    const shadcn = buildInstructions(false, undefined, false, []);
    expect(shadcn).not.toContain("Style with the `sx` object");
    // No framework-specific intro prepended — the default opening leads.
    expect(shadcn).not.toContain("**no-framework** Velloo design folder");
    expect(shadcn).toContain("pinned shadcn snapshot");
  });

  test("a no-framework folder is framed as bare primitives, correcting the shadcn claim", () => {
    const none = buildInstructions(
      false,
      undefined,
      false,
      introOf(createNoneProvider(), "tailwind-classname"),
    );
    expect(none).toContain("no-framework");
    expect(none).toContain("NO shadcn surface");
    // Still Tailwind-shaped (no sx), and the correction leads.
    expect(none).not.toContain("Style with the `sx` object");
    expect(none.indexOf("no-framework")).toBeLessThan(none.indexOf("pinned shadcn snapshot"));
  });

  test("a none/none folder is framed for inline styles (channel picks the variant)", () => {
    const inline = buildInstructions(
      false,
      undefined,
      false,
      introOf(createNoneProvider(), "style"),
    );
    expect(inline).toContain("no CSS framework");
    expect(inline).toContain("Style with the `style` object");
  });

  test("surfaces waiting share-link comments as one line when the count is positive", () => {
    const text = buildInstructions(false, undefined, false, [], 3);
    expect(text).toContain(
      "**3 unresolved share-link comments are waiting as annotations** — read them via `list_annotations`; refresh with `pull_comments`.",
    );
  });

  test("the waiting-comments line reads correctly for a single comment", () => {
    const text = buildInstructions(false, undefined, false, [], 1);
    expect(text).toContain("**1 unresolved share-link comment is waiting as an annotation**");
  });

  test("omits the waiting-comments line at zero (and by default)", () => {
    expect(buildInstructions(false)).not.toContain("waiting as annotation");
    expect(buildInstructions(false, undefined, false, [], 0)).not.toContain(
      "waiting as annotation",
    );
  });
});
