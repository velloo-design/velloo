import { describe, expect, test } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { StyleChannelKind } from "@velloo/provider";
import { createProvider as createAntdProvider } from "@velloo/provider-antd";
import { createProvider as createChakraProvider } from "@velloo/provider-chakra";
import { createProvider as createHtmlProvider } from "@velloo/provider-html";
import { createProvider as createMuiProvider } from "@velloo/provider-mui";
import { createProvider as createNoneProvider } from "@velloo/provider-none";
import { createProvider as createShadcnProvider } from "@velloo/provider-shadcn-upstream";
import { agentLaunchFor } from "../agent/launch.ts";
import type { DesignFolder } from "../design-folder.ts";
import { parseMcpSessionUrl, type SessionDesigns } from "../mcp/designs.ts";
import {
  BRIEF_LIMITS,
  type BriefOptions,
  buildInstructions,
  VISIBLE_INSTRUCTION_CHARS,
  withDiagnosticsOnce,
} from "../mcp/server.ts";
import { designConfig } from "../testing/design-folder.ts";

/** Every adapter's paragraph, per style channel it offers, the way buildMcpServer resolves it. */
const INTROS: [string, string | undefined][] = (
  [
    ["shadcn", createShadcnProvider(), "tailwind-classname"],
    ["mui", createMuiProvider(), "sx"],
    ["antd", createAntdProvider(), "style"],
    ["chakra", createChakraProvider(), "sx"],
    ["none", createNoneProvider(), "tailwind-classname"],
    ["none/none", createNoneProvider(), "style"],
    ["html", createHtmlProvider(), "style"],
  ] as const
).map(([name, provider, channel]) => [name, provider.mcpIntro?.(channel as StyleChannelKind)]);

const introOf = (name: string): string | undefined => INTROS.find(([n]) => n === name)?.[1];

/** Longer than any limit: what the brief writes of it is the longest it allows. */
const LONG = "x".repeat(200);

const SEVERAL: SessionDesigns = {
  current: "marketing-site",
  names: ["admin-console", "brand", "docs", "marketing-site", "mobile", "web"],
  switchable: true,
  pick: undefined,
};

/**
 * Each option's every value that changes what the brief says. Keyed by the
 * whole of BriefOptions, so an option added there fails to compile here until
 * its values are listed — and with them, every brief it can produce is held to
 * the limit below.
 */
const DOMAINS: { [K in keyof Required<BriefOptions>]: BriefOptions[K][] } = {
  feedbackEnabled: [false, true],
  canvasUrl: [undefined, `http://127.0.0.1:65535/${LONG}`],
  intro: [undefined, ...INTROS.map(([, intro]) => intro)],
  appComponents: [false, true],
  openComments: [0, 1, 99_999],
  hasApp: [false, true],
  bare: [false, true],
  surface: [{ mode: "guided" }, { mode: "full" }],
  designs: [
    null,
    { ...SEVERAL, current: LONG, names: [...SEVERAL.names, LONG] },
    { ...SEVERAL, current: LONG, names: [...SEVERAL.names, LONG], switchable: false },
    { ...SEVERAL, current: LONG, switchable: false, pick: "arbitrary" },
  ],
  designSystemPath: [null, `../${LONG}/DESIGN.md`],
  javaScriptAppTheme: [null, { file: `src/${LONG}/theme.ts` }, { defaults: LONG }, {}],
  inCanvas: [false, true],
};

function* everyBrief(): Generator<[BriefOptions, string]> {
  const keys = Object.keys(DOMAINS) as (keyof BriefOptions)[];
  const walk = function* (at: number, options: BriefOptions): Generator<[BriefOptions, string]> {
    const key = keys[at];
    if (key === undefined) {
      yield [options, buildInstructions(options)];
      return;
    }
    for (const value of DOMAINS[key]) yield* walk(at + 1, { ...options, [key]: value });
  };
  yield* walk(0, {});
}

describe("buildInstructions", () => {
  /**
   * Claude Code shows a server's instructions up to VISIBLE_INSTRUCTION_CHARS
   * and drops the rest without a word, so a brief past it loses its last
   * paragraphs silently. Every brief must fit whole: a framework's detail and
   * an app recipe's notes go with `list_components`' index instead.
   */
  test("every brief it can write fits what a client shows", () => {
    let count = 0;
    let longest = { length: 0, options: {} as BriefOptions };
    for (const [options, brief] of everyBrief()) {
      count++;
      if (brief.length > longest.length) longest = { length: brief.length, options };
    }
    expect(count).toBeGreaterThan(10_000);
    expect(longest.length, JSON.stringify(longest.options)).toBeLessThanOrEqual(
      VISIBLE_INSTRUCTION_CHARS,
    );
  });

  test("a long name or path is clipped, a path keeping its file name", () => {
    const text = buildInstructions({
      designs: { ...SEVERAL, current: LONG },
      designSystemPath: `../${LONG}/DESIGN.md`,
    });
    expect(text).not.toContain(LONG);
    expect(text).toContain("/DESIGN.md`**");
    expect(text).toContain(`**Design: \`${"x".repeat(BRIEF_LIMITS.designName - 1)}…\`**`);
    expect(buildInstructions({ openComments: 250 })).toContain("**99+ open feedback threads");
  });

  test("every adapter's paragraph stays a paragraph", () => {
    for (const [name, intro] of INTROS) {
      expect(intro, name).toBeDefined();
      expect(intro?.includes("\n"), name).toBe(false);
    }
  });

  test("what every brief carries, whatever else it says", () => {
    for (const mode of ["guided", "full"] as const) {
      const text = buildInstructions({ surface: { mode } });
      expect(text).toContain("Never edit the design folder");
      expect(text).toContain("`compose`");
      expect(text).toContain('get_screen { mode: "jsx" }');
      expect(text).toContain("list_components");
      expect(text).toContain("`velloo://guide/*` resources");
      expect(text).not.toContain("velloo://guide/porting");
    }
  });

  test("most important first: the design, then how to work, then where to watch and what is waiting", () => {
    const text = buildInstructions({
      designs: SEVERAL,
      canvasUrl: "http://127.0.0.1:54321",
      openComments: 2,
      intro: introOf("mui"),
      feedbackEnabled: true,
    });
    const order = [
      "**Design: `marketing-site`**",
      "Never edit the design folder",
      "http://127.0.0.1:54321",
      "2 open feedback threads",
      "Material UI",
      "send_feedback",
    ].map((marker) => text.indexOf(marker));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test("the feedback paragraph, with its consent rule, only when opted in", () => {
    expect(buildInstructions()).not.toContain("send_feedback");
    const text = buildInstructions({ feedbackEnabled: true });
    expect(text).toContain("send_feedback");
    expect(text).toContain("only once the user approves the exact `body`");
  });

  test("surfaces the live canvas URL when one is given (stdio binds an ephemeral port)", () => {
    const text = buildInstructions({ canvasUrl: "http://127.0.0.1:54321" });
    expect(text).toContain("http://127.0.0.1:54321");
    expect(text).toContain("give the user this URL");
    expect(buildInstructions()).not.toContain("give the user this URL");
  });

  test("an agent in the canvas's Agent tab is told the user is watching, not sent a URL", () => {
    const text = buildInstructions({ canvasUrl: "http://127.0.0.1:54321", inCanvas: true });
    expect(text).toContain("You are running in the Velloo canvas's Agent tab");
    expect(text).not.toContain("http://127.0.0.1:54321");
    const folder = { root: "/w/d", config: designConfig() } as DesignFolder;
    const launch = agentLaunchFor(folder, "http://127.0.0.1:9/mcp", ["velloo", "mcp", "/w/d"]);
    expect(parseMcpSessionUrl(launch.mcp?.url).inCanvas).toBe(true);
    expect(launch.mcp?.command).toEqual(["velloo", "mcp", "/w/d", "--in-canvas"]);
    expect(parseMcpSessionUrl("http://127.0.0.1:9/mcp?switch=1").inCanvas).toBe(false);
  });

  // The base brief is framework-NEUTRAL: each adapter states its own vocabulary
  // and style channel positively, rather than correcting a shadcn claim.
  test("each framework is named with its style channel, and the neutral brief names none", () => {
    const of = (name: string) => buildInstructions({ intro: introOf(name) });
    expect(of("mui")).toContain("Material UI");
    expect(of("mui")).toContain("Style through `sx`");
    expect(of("antd")).toContain("Ant Design");
    expect(of("antd")).toContain("Style through the inline `style` object");
    expect(of("chakra")).toContain("Chakra UI");
    expect(of("chakra")).toContain("Style through `sx`");
    expect(of("none")).toContain("no component library");
    expect(of("none")).toContain("Tailwind classes");
    expect(of("none")).not.toContain("Style through `sx`");
    expect(of("none/none")).toContain("no CSS framework");
    expect(of("none/none")).toContain("Style through inline `style` objects");
    expect(of("html")).toContain("HTML/htmx");
    const shadcn = of("shadcn");
    expect(shadcn).toContain("client-safe components from the app's");
    expect(shadcn).toContain("falling back per component");
    expect(shadcn).toContain("component_status");
    expect(shadcn).not.toContain("npx shadcn");
    const neutral = buildInstructions();
    for (const claim of ["shadcn", "Style through `sx`", "no CSS framework"]) {
      expect(neutral).not.toContain(claim);
    }
  });

  test("a design with no boards yet is sent to set itself up when there is an app to match", () => {
    const forApp = buildInstructions({ bare: true, hasApp: true });
    expect(forApp).toContain("Set this design up for its app first");
    for (const step of [
      "import_theme",
      "preview_status",
      "check_components",
      "set_design_language",
      "velloo://guide/porting",
      "velloo-setup",
    ]) {
      expect(forApp).toContain(step);
    }
    expect(forApp).not.toContain("**Bare folder.**");
    // Setting up comes first; matching pages to the app comes after it.
    expect(forApp).not.toContain("**Matching an existing app:**");
    // With no app there is nothing to match, only a theme to choose.
    const greenfield = buildInstructions({ bare: true });
    expect(greenfield).toContain("**Bare folder.**");
    expect(greenfield).not.toContain("check_components");
    expect(greenfield).not.toContain("Matching an existing app");
    expect(buildInstructions()).not.toContain("Set this design up");
    // Once it has boards, the app is one to match.
    expect(buildInstructions({ hasApp: true })).toContain("**Matching an existing app:**");
  });

  test("the app's own components are said once, and their check only where setup doesn't already say it", () => {
    const later = buildInstructions({ hasApp: true, appComponents: true });
    expect(later).toContain("Build with the app's own components first");
    expect(later).toContain("check_components");
    const setup = buildInstructions({ hasApp: true, bare: true, appComponents: true });
    expect(setup.match(/check_components/g)).toHaveLength(1);
    expect(setup.indexOf("Set this design up")).toBeLessThan(
      setup.indexOf("Build with the app's own components first"),
    );
  });

  describe("an app themed in JavaScript is not sent to import a stylesheet", () => {
    const setup = (js: Exclude<BriefOptions["javaScriptAppTheme"], undefined>) =>
      buildInstructions({ bare: true, hasApp: true, javaScriptAppTheme: js });

    test("a stylesheet-themed app keeps the import step", () => {
      expect(setup(null)).toContain("`import_theme { cssPath }`");
    });

    test("the theme file init read is the one to compare with, in place of the import", () => {
      const text = setup({ file: "src/theme.ts" });
      expect(text).toContain("read the app's theme from `src/theme.ts`");
      expect(text).not.toContain("import_theme");
    });

    test("an app on its library's defaults, or themed in JavaScript with no record, is told so", () => {
      expect(setup({ defaults: "Mantine" })).toContain("the design is on Mantine's");
      expect(setup({})).toContain("The app is themed in JavaScript");
      expect(setup({})).not.toContain("import_theme");
    });
  });

  test("surfaces open visual feedback as one line when the count is positive", () => {
    const text = buildInstructions({ openComments: 3 });
    expect(text).toContain("**3 open feedback threads are waiting on you.**");
    expect(text).toContain("`list_comment_threads`");
    expect(text).toContain("`update_comment_thread`");
    expect(buildInstructions({ openComments: 1 })).toContain(
      "**1 open feedback thread is waiting on you.**",
    );
    expect(buildInstructions()).not.toContain("list_comment_threads");
  });

  test("a design system document is named, and said to outrank the defaults", () => {
    const text = buildInstructions({ designSystemPath: "../DESIGN.md" });
    expect(text).toContain("**This folder follows `../DESIGN.md`**");
    expect(text).toContain("outranks generic defaults");
  });

  test("a screen's diagnostics are said once, and again only when they change", async () => {
    type Handler = (args: unknown, extra: unknown) => Promise<{ content: { text: string }[] }>;
    const handlers = new Map<string, Handler>();
    const mcp = {
      registerTool: (name: string, _config: unknown, cb: Handler) => {
        handlers.set(name, cb);
      },
    } as unknown as McpServer;
    withDiagnosticsOnce(mcp);
    let diagnostics = [
      { code: "theme/raw-color", path: [0] },
      { code: "theme/raw-color", path: [1] },
    ];
    const reply = async () => ({
      content: [
        { type: "text", text: JSON.stringify({ similarity: 0.9, diagnostics }) },
        { type: "text", text: "png" },
      ],
    });
    mcp.registerTool("compare_to_url", {}, reply as never);
    mcp.registerTool("screenshot", {}, reply as never);
    const call = async (tool: string, screenId: string) =>
      JSON.parse((await handlers.get(tool)?.({ screenId }, {}))?.content[0]?.text ?? "{}");

    expect((await call("compare_to_url", "home")).diagnostics).toHaveLength(2);
    // The same set, from any tool, for the same screen: its count, and the rest of the result.
    const again = await call("screenshot", "home");
    expect(again).toEqual({
      similarity: 0.9,
      diagnosticsUnchanged: 'the same 2 as in the last result for "home"',
    });
    // Another screen has heard nothing yet; a changed set is sent whole.
    expect((await call("screenshot", "pricing")).diagnostics).toHaveLength(2);
    diagnostics = [{ code: "theme/raw-color", path: [0] }];
    expect((await call("compare_to_url", "home")).diagnostics).toHaveLength(1);
    expect((await handlers.get("screenshot")?.({ screenId: "home" }, {}))?.content).toHaveLength(2);
  });
});
