import { afterAll, beforeEach, expect, test } from "bun:test";
import type { DesignRulesState } from "../api.ts";
import { $, $$, domSuite, interact, mount, press, settle, text, typeInto } from "./dom.ts";

/**
 * The rules step of the design-language stage. Rules are saved one edit at a
 * time, so what matters is that a second edit made before the first has been
 * answered is built on it — and that a repo's DESIGN.md is shown, never edited.
 */

const saved: Array<{ intent: string; rules: Array<{ kind: string; text: string }> }> = [];
let replyAfterMs = 0;

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), "http://localhost");
  if (url.pathname === "/api/design-language/rules" && init?.method === "POST") {
    const body = JSON.parse(String(init.body));
    saved.push(body);
    await new Promise((resolve) => setTimeout(resolve, replyAfterMs));
    return Response.json({ rules: { source: { path: "guidance.md", writable: true }, ...body } });
  }
  throw new Error(`unexpected fetch: ${url.pathname}`);
}) as typeof fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});

const { RulesStep } = await import("../components/DesignLanguage/RulesStep.tsx");
const { useCanvas } = await import("../store.ts");
const { setApiConnected } = await import("../api/connection.ts");

function Connected() {
  const rules = useCanvas((s) => s.languageRules);
  return rules ? <RulesStep state={rules} /> : null;
}

function seed(rules: DesignRulesState): void {
  useCanvas.setState({ languageRules: rules });
}

async function addRule(kind: "do" | "dont", value: string): Promise<void> {
  const input = $(`#language-rule-${kind}`) as HTMLInputElement;
  await interact(() => typeInto(input, value));
  await interact(() => press(input, "Enter"));
}

beforeEach(() => {
  saved.length = 0;
  replyAfterMs = 0;
  setApiConnected(true);
});

domSuite("design language rules", () => {
  test("a rule added before the last save is answered is saved on top of it", async () => {
    seed({ source: null, intent: "", rules: [] });
    replyAfterMs = 30;
    const view = await mount(<Connected />);
    try {
      await addRule("do", "One primary action per view");
      await addRule("dont", "Shadows on flat surfaces");
      expect(saved.at(-1)?.rules).toEqual([
        { kind: "do", text: "One primary action per view" },
        { kind: "dont", text: "Shadows on flat surfaces" },
      ]);
      await settle(80);
      expect($$("[data-slot='item']").map(text)).toEqual([
        "One primary action per view",
        "Shadows on flat surfaces",
      ]);
    } finally {
      await view.unmount();
    }
  });

  test("a repo's DESIGN.md is shown read-only", async () => {
    seed({
      source: { path: "../DESIGN.md", writable: false },
      intent: "Calm.",
      rules: [{ kind: "dont", text: "use two accents" }],
    });
    const view = await mount(<Connected />);
    try {
      expect(text($("[data-slot='alert']"))).toContain("../DESIGN.md");
      expect($("#language-rule-do")).toBeNull();
      expect($("[aria-label^='Remove rule']")).toBeNull();
      expect(($("#language-intent") as HTMLTextAreaElement).readOnly).toBe(true);
    } finally {
      await view.unmount();
    }
  });
});
