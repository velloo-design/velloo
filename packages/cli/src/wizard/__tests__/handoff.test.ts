import { describe, expect, test } from "bun:test";
import type { Board, Screen } from "@velloo/schema";
import type { InitialContent, WizardAnswers } from "../answers.ts";
import {
  buildHandoffPrompt,
  expandHandoffPrompt,
  SCREENS_PLACEHOLDER,
  wantsHandoff,
} from "../handoff.ts";

const BASE: WizardAnswers = {
  appRoot: "/home/me/proj",
  scanRoot: "/home/me/proj",
  folder: "/home/me/proj/velloo",
  library: "shadcn-upstream",
  source: "binary",
  componentsRelative: "src/components/ui",
  initialContent: "scan",
};

const screen = (id: string, name: string): Screen => ({
  id,
  name,
  tree: { $ref: "Box" },
});

const board = (groups: Board["groups"]): Board => ({
  id: "app",
  name: "App",
  frames: [],
  groups,
});

describe("buildHandoffPrompt", () => {
  test("lists screens as a placeholder, not inline", () => {
    const prompt = buildHandoffPrompt(
      BASE,
      [screen("index", "Home"), screen("about", "About")],
      [board([])],
    );
    expect(prompt).toContain(SCREENS_PLACEHOLDER);
    expect(prompt).toContain("These screens are already scaffolded");
    expect(prompt).not.toContain("- Home");
  });

  test("agentPicksFirst adds the pick-the-first-screen instruction", () => {
    const withFlag = buildHandoffPrompt(
      { ...BASE, agentPicksFirst: true },
      [screen("a", "A")],
      [board([])],
    );
    const without = buildHandoffPrompt(BASE, [screen("a", "A")], [board([])]);
    expect(withFlag).toContain("Start with the highest-impact screen");
    expect(without).not.toContain("Start with the highest-impact screen");
  });

  test("folder-ownership and feature guidance stay in the MCP instructions, not here", () => {
    const prompt = buildHandoffPrompt(BASE, [screen("a", "A")], [board([])]);
    expect(prompt).not.toContain("Velloo lives in");
    expect(prompt).not.toContain("velloo run");
    expect(prompt).not.toContain("snippets");
    expect(prompt).not.toContain("semantic theme tokens");
  });

  test("a multi-app scan names each app instead of the single UI dir", () => {
    const answers: WizardAnswers = {
      ...BASE,
      scanRoot: "/home/me/proj/apps/web",
      selectedRoutes: [
        {
          id: "web-index",
          name: "Web / Home",
          routePath: "/",
          sourceFile: "x",
          appRel: "apps/web",
        },
        {
          id: "admin-index",
          name: "Admin / Home",
          routePath: "/",
          sourceFile: "y",
          appRel: "apps/admin",
        },
      ],
    };
    const prompt = buildHandoffPrompt(answers, [screen("web-index", "Web / Home")], [board([])]);
    expect(prompt).toContain("monorepo with 2 apps");
    expect(prompt).toContain("`apps/web`");
    expect(prompt).toContain("`apps/admin`");
    expect(prompt).not.toContain("This app's UI lives in");
  });

  test("mentions pre-grouped frames only when a board has groups", () => {
    const grouped = buildHandoffPrompt(
      BASE,
      [screen("a", "A")],
      [board([{ id: "g-settings", name: "Settings" }])],
    );
    const flat = buildHandoffPrompt(BASE, [screen("a", "A")], [board([])]);
    expect(grouped).toContain("pre-grouped");
    expect(flat).not.toContain("pre-grouped");
  });
  test("redesign-screen handoff asks to recreate then explore alternatives", () => {
    const prompt = buildHandoffPrompt(
      { ...BASE, initialContent: "redesign-screen", screenName: "Pricing" },
      [screen("pricing", "Pricing")],
      [board([])],
    );
    expect(prompt).toContain("Pricing");
    expect(prompt).toContain("Recreate");
    expect(prompt.toLowerCase()).toContain("explore alternatives");
  });

  test("component handoff embeds the description", () => {
    const prompt = buildHandoffPrompt(
      {
        ...BASE,
        initialContent: "component",
        componentDescription: "sidebar nav",
      },
      [],
      [board([])],
    );
    expect(prompt).toContain("sidebar nav");
    expect(prompt.toLowerCase()).toContain("explore alternatives");
  });

  test("custom handoff embeds the request", () => {
    const prompt = buildHandoffPrompt(
      {
        ...BASE,
        initialContent: "custom",
        customRequest: "a playful onboarding flow",
      },
      [],
      [board([])],
    );
    expect(prompt).toContain("a playful onboarding flow");
  });

  test("every start that reads the host app opens by calibrating to it", () => {
    const modes: InitialContent[] = ["scan", "redesign-screen", "component", "custom"];
    for (const initialContent of modes) {
      expect(wantsHandoff({ ...BASE, initialContent })).toBe(true);
      const prompt = buildHandoffPrompt(
        { ...BASE, initialContent },
        [screen("a", "A")],
        [board([])],
      );
      expect(prompt).toContain("velloo-setup");
    }
  });

  test("calibration comes before the design work, not after", () => {
    const prompt = buildHandoffPrompt(
      { ...BASE, initialContent: "redesign-screen", screenName: "Pricing" },
      [screen("pricing", "Pricing")],
      [board([])],
    );
    expect(prompt.indexOf("velloo-setup")).toBeLessThan(prompt.indexOf("**Recreate**"));
  });

  test("the self-contained starts get no handoff at all", () => {
    for (const initialContent of ["sample", "blank"] as InitialContent[]) {
      expect(wantsHandoff({ ...BASE, initialContent })).toBe(false);
    }
  });
});

describe("expandHandoffPrompt", () => {
  test("replaces the placeholder with one bullet per screen", () => {
    const prompt = buildHandoffPrompt(
      BASE,
      [screen("index", "Home"), screen("about", "About")],
      [board([])],
    );
    const expanded = expandHandoffPrompt(prompt, [
      screen("index", "Home"),
      screen("about", "About"),
    ]);
    expect(expanded).not.toContain(SCREENS_PLACEHOLDER);
    expect(expanded).toContain("  - Home");
    expect(expanded).toContain("  - About");
  });

  test("no-op when the user edited the placeholder away", () => {
    const edited = "Build the design however you like.";
    expect(expandHandoffPrompt(edited, [screen("a", "A")])).toBe(edited);
  });
});
