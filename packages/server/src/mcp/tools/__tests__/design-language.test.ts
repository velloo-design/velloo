import { afterEach, describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  designConfig,
  type TestContext,
  type TestContextOptions,
  testContext,
} from "../../../testing/design-folder.ts";
import { registerDesignLanguageTools } from "../design-language.ts";
import type { McpResult } from "../result.ts";

/**
 * `set_design_language` as an agent calls it: a proposal in two halves, either
 * of which can be sent alone, and an answer that sends the user to the canvas
 * to review it — a rule nobody is shown is only a file.
 */

type ToolHandler = (args: Record<string, unknown>, extra: unknown) => Promise<McpResult>;

let t: TestContext;
afterEach(() => t?.cleanup());

async function open(options: TestContextOptions = {}): Promise<void> {
  t = await testContext({ label: "set-design-language", nested: true, ...options });
}

async function setLanguage(args: Record<string, unknown>, canvasUrl?: string) {
  const mcp = new McpServer({ name: "test", version: "0.0.0" });
  registerDesignLanguageTools(mcp, t.ctx, canvasUrl);
  const tools = (mcp as unknown as { _registeredTools: Record<string, { handler: ToolHandler }> })
    ._registeredTools;
  const result = await (tools.set_design_language as { handler: ToolHandler }).handler(args, {});
  const first = result.content[0];
  return {
    isError: result.isError === true,
    body: JSON.parse(first?.type === "text" ? first.text : "{}") as Record<string, unknown>,
  };
}

const guidance = () => readFile(join(t.root, "guidance.md"), "utf8");

const RULES = [
  { kind: "do", text: "One accent per screen" },
  { kind: "dont", text: "Shadows on flat surfaces" },
];

describe("set_design_language", () => {
  test("saves the proposal to guidance.md and points the user at the canvas to review it", async () => {
    await open();
    const { isError, body } = await setLanguage(
      { intent: "Calm and dense.", rules: RULES },
      "http://127.0.0.1:7395",
    );
    expect(isError).toBe(false);
    expect(body).toMatchObject({
      source: { path: "guidance.md", writable: true },
      intent: "Calm and dense.",
      rules: RULES,
    });
    expect(body.review).toContain("Proposed, not agreed");
    expect(body.review).toContain("http://127.0.0.1:7395/?view=language");
    const saved = await guidance();
    expect(saved).toContain("Calm and dense.");
    expect(saved).toContain("- Do: One accent per screen");
    expect(saved).toContain("- Don't: Shadows on flat surfaces");
    // The canvas refreshes on it like any other change to the design language.
    expect(t.events).toContainEqual({ type: "theme-changed" });
  });

  test("with no canvas running, the review note names the place without a link", async () => {
    await open();
    const { body } = await setLanguage({ intent: "Calm.", rules: RULES });
    expect(body.review).toContain("under Design language —");
    expect(body.review).not.toContain("view=language");
  });

  test("either half sent alone leaves the other as it was saved", async () => {
    await open();
    await setLanguage({ intent: "Calm and dense.", rules: RULES });

    const intentOnly = await setLanguage({ intent: "Loud." });
    expect(intentOnly.body).toMatchObject({ intent: "Loud.", rules: RULES });

    const rulesOnly = await setLanguage({ rules: [RULES[0]] });
    expect(rulesOnly.body).toMatchObject({ intent: "Loud.", rules: [RULES[0]] });
    // The list replaces the saved one: the rule left out is gone from the file.
    expect(await guidance()).not.toContain("Shadows on flat surfaces");
  });

  test("is refused when the design follows the repo's DESIGN.md, which is left exactly as written", async () => {
    await open({ config: designConfig({ hostApp: { root: ".." } }) });
    const designMd = join(t.root, "..", "DESIGN.md");
    const text = "## Colors\n\nIndigo.\n\n## Do's and Don'ts\n\n- Don't use two accents.\n";
    await writeFile(designMd, text, "utf8");

    const { isError, body } = await setLanguage({ intent: "Calm.", rules: RULES });
    expect(isError).toBe(true);
    expect(body.kind).toBe("BadRequest");
    expect(JSON.stringify(body)).toContain("../DESIGN.md, which belongs to the repo");
    expect(body.review).toBeUndefined();
    expect(await readFile(designMd, "utf8")).toBe(text);
    await expect(guidance()).rejects.toThrow();
  });
});
