import { describe, expect, test } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createProvider as createAntdProvider } from "@velloo/provider-antd";
import { createProvider as createChakraProvider } from "@velloo/provider-chakra";
import { createProvider as createMuiProvider } from "@velloo/provider-mui";
import { createProvider as createNoneProvider } from "@velloo/provider-none";
import { createProvider as createShadcnProvider } from "@velloo/provider-shadcn-upstream";
import {
  buildInstructions,
  splitBrief,
  VISIBLE_INSTRUCTION_CHARS,
  withBriefContinuation,
} from "../mcp/server.ts";

/** Resolve an adapter's intro the way buildMcpServer does. */
const introOf = (
  p: ReturnType<typeof createMuiProvider>,
  channel: "sx" | "tailwind-classname" | "style",
): readonly string[] => p.mcpIntro?.(channel) ?? [];

describe("buildInstructions", () => {
  test("points at the advertised guide resources without duplicating their catalogue", () => {
    const text = buildInstructions(false);
    expect(text).toContain("advertised `velloo://guide/*` resources");
    expect(text).not.toContain("velloo://guide/components");
    expect(text).not.toContain("velloo://guide/porting");
  });

  /**
   * A 292-component library is only useful if the agent reaches into it. Left
   * to itself a model builds a labelled input out of Box + Label + Text —
   * plausible markup that loses the library's states and dark-mode behavior,
   * and hands the developer a div stack at `emit_code`. The brief has to name
   * the substitution, not just say "components are available".
   */
  test("steers toward a real component family over a hand-rolled Box stack", () => {
    const text = buildInstructions(false);
    expect(text).toContain("Use the library's own components");
    for (const family of ["Field", "InputGroup", "Item", "Empty", "ButtonGroup"]) {
      expect(text).toContain(family);
    }
    // And says how to read the catalog it is pointing at.
    expect(text).toContain("pieces");
  });

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

  // The base brief is framework-NEUTRAL: each adapter states its own vocabulary
  // and style channel positively, rather than correcting a shadcn claim that the
  // brief no longer makes. So the checks are "does the frame lead, and does it
  // name this framework's channel" — not "does it contradict the default".
  // "Leads" is measured against what a client is sure to show: the framing has
  // to be inside the visible part of the brief, not merely early in the text.
  const leads = (text: string, marker: string): boolean =>
    splitBrief(text).instructions.includes(marker);

  test("a MUI (sx) folder is framed for Material UI and leads with it", () => {
    const mui = buildInstructions(false, undefined, introOf(createMuiProvider(), "sx"));
    expect(mui).toContain("Material UI");
    expect(mui).toContain("Style through `sx`");
    expect(leads(mui, "Material UI")).toBe(true);
    // The neutral base must not assert a component library of its own.
    expect(mui).not.toContain("pinned shadcn snapshot");
  });

  test("shadcn guidance reports repo-backed fidelity without asking for host mutation", () => {
    const shadcn = buildInstructions(
      false,
      undefined,
      introOf(createShadcnProvider(), "tailwind-classname"),
    );
    expect(shadcn).toContain("imports client-safe components directly from the app's");
    expect(shadcn).toContain("component_status");
    expect(shadcn).toContain("falls back per component");
    expect(shadcn).not.toContain("install_component");
    expect(shadcn).not.toContain("npx shadcn");
  });

  test("an antd (style) folder is framed for Ant Design + inline styles", () => {
    const antd = buildInstructions(false, undefined, introOf(createAntdProvider(), "style"));
    expect(antd).toContain("Ant Design");
    expect(antd).toContain("Style through the inline `style` object");
    expect(leads(antd, "Ant Design")).toBe(true);
    expect(antd).not.toContain("pinned shadcn snapshot");
  });

  test("a chakra (sx) folder is framed for Chakra UI", () => {
    const chakra = buildInstructions(false, undefined, introOf(createChakraProvider(), "sx"));
    expect(chakra).toContain("Chakra UI");
    expect(chakra).toContain("Style through `sx`");
    expect(leads(chakra, "Chakra UI")).toBe(true);
    expect(chakra).not.toContain("pinned shadcn snapshot");
  });

  test("the base brief names no framework when no adapter intro is supplied", () => {
    const bare = buildInstructions(false, undefined, []);
    for (const claim of ["pinned shadcn snapshot", "Style through `sx`", "no CSS framework"]) {
      expect(bare).not.toContain(claim);
    }
    // It still frames the folder and the neutral style channel.
    expect(bare).toContain("Velloo design folder");
    expect(bare).toContain("Styling is framework-native");
  });

  test("a no-framework folder is framed as bare primitives", () => {
    const none = buildInstructions(
      false,
      undefined,
      introOf(createNoneProvider(), "tailwind-classname"),
    );
    expect(none).toContain("no component library");
    expect(none).toContain("Tailwind classes");
    expect(none).not.toContain("Style through `sx`");
    expect(leads(none, "no component library")).toBe(true);
  });

  test("a none/none folder is framed for inline styles (channel picks the variant)", () => {
    const inline = buildInstructions(false, undefined, introOf(createNoneProvider(), "style"));
    expect(inline).toContain("no CSS framework");
    expect(inline).toContain("Style through inline `style` objects");
  });

  test("surfaces open visual feedback as one line when the count is positive", () => {
    const text = buildInstructions(false, undefined, [], 3);
    expect(text).toContain("**3 open visual feedback threads are waiting on you.**");
    expect(text).toContain("Read them with the `list_comment_threads` operation");
    expect(text).toContain("`update_comment_thread`");
    // Named as an operation, not a tool: on the guided surface both are
    // reachable only through the façade.
    expect(text).not.toContain("Read them with `list_comment_threads`");
    expect(text).toContain("velloo://guide/comments");
  });

  describe("what a client that shows only the start of the brief still gets", () => {
    const CANVAS = "http://127.0.0.1:54321";
    const providers = [
      ["shadcn", introOf(createShadcnProvider(), "tailwind-classname")],
      ["mui", introOf(createMuiProvider(), "sx")],
      ["antd", introOf(createAntdProvider(), "style")],
      ["chakra", introOf(createChakraProvider(), "sx")],
      ["none", introOf(createNoneProvider(), "tailwind-classname")],
      ["none/none", introOf(createNoneProvider(), "style")],
    ] as const;

    for (const mode of ["guided", "full"] as const) {
      for (const [name, intro] of providers) {
        test(`${name} on the ${mode} surface`, () => {
          const full = buildInstructions(false, CANVAS, intro, 2, 3, false, { mode });
          const { instructions, later } = splitBrief(full);
          expect(instructions.length).toBeLessThanOrEqual(VISIBLE_INSTRUCTION_CHARS);
          // How to operate, where the canvas is, what the user is waiting for…
          expect(instructions).toContain("Never edit the design folder");
          expect(instructions).toContain("`compose`");
          expect(instructions).toContain(CANVAS);
          expect(instructions).toContain("2 open visual feedback threads");
          // …and nothing is lost: the rest is whole paragraphs, handed over later.
          expect(later).not.toBeNull();
          expect(instructions).toContain("continues in the result of your first call");
          const rebuilt = `${instructions.split("\n\n").slice(0, -1).join("\n\n")}\n\n${later}`;
          expect(rebuilt).toBe(full);
        });
      }
    }

    test("a brief that fits is sent whole, with nothing deferred", () => {
      const full = buildInstructions(false, CANVAS, [], 0, null, false, { mode: "guided" });
      expect(full.length).toBeLessThanOrEqual(VISIBLE_INSTRUCTION_CHARS);
      expect(splitBrief(full)).toEqual({ instructions: full, later: null });
    });
  });

  test("the deferred part arrives on the first tool result, whichever tool that is, and only once", async () => {
    type Handler = (args: unknown, extra: unknown) => Promise<{ content: { text: string }[] }>;
    const handlers = new Map<string, Handler>();
    const mcp = {
      registerTool: (name: string, _config: unknown, cb: Handler) => {
        handlers.set(name, cb);
      },
    } as unknown as McpServer;
    withBriefContinuation(mcp, "**Style through `sx`.**");
    const result = async () => ({ content: [{ type: "text", text: "{}" }] });
    mcp.registerTool("get_theme", {}, result as never);
    mcp.registerTool("list_components", {}, result as never);

    const first = await handlers.get("list_components")?.({}, {});
    expect(first?.content).toHaveLength(2);
    expect(first?.content[0]?.text).toBe("{}");
    expect(first?.content[1]?.text).toContain("The rest of this session's brief");
    expect(first?.content[1]?.text).toContain("**Style through `sx`.**");
    expect((await handlers.get("get_theme")?.({}, {}))?.content).toHaveLength(1);
    expect((await handlers.get("list_components")?.({}, {}))?.content).toHaveLength(1);
  });

  test("the guided surface points at the guide resources", () => {
    const guided = buildInstructions(false, undefined, [], 0, null, false, { mode: "guided" });
    expect(guided).toContain("velloo://guide/*");
  });

  test("the waiting-comments line reads correctly for a single comment", () => {
    const text = buildInstructions(false, undefined, [], 1);
    expect(text).toContain("**1 open visual feedback thread is waiting on you.**");
  });

  test("omits the waiting-comments line at zero (and by default)", () => {
    expect(buildInstructions(false)).not.toContain("feedback thread is waiting");
    expect(buildInstructions(false, undefined, [], 0)).not.toContain("feedback thread is waiting");
    expect(buildInstructions(false)).not.toContain("list_comment_threads");
  });
});
