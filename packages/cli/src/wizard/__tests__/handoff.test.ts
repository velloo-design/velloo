import { describe, expect, test } from "bun:test";
import type { Board, Screen } from "@velloo/schema";
import type { WizardAnswers } from "../answers.ts";
import { buildHandoffPrompt, expandHandoffPrompt, SCREENS_PLACEHOLDER } from "../handoff.ts";

const BASE: WizardAnswers = {
  appRoot: "/home/me/proj",
  scanRoot: "/home/me/proj",
  folder: "/home/me/proj/velloo",
  library: "shadcn-react",
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
    expect(prompt).toContain("these 2 screens");
    expect(prompt).not.toContain("- Home");
  });

  test("agentPicksFirst adds the pick-the-first-screen instruction", () => {
    const withFlag = buildHandoffPrompt(
      { ...BASE, agentPicksFirst: true },
      [screen("a", "A")],
      [board([])],
    );
    const without = buildHandoffPrompt(BASE, [screen("a", "A")], [board([])]);
    expect(withFlag).toContain("choose the highest-impact screen yourself");
    expect(without).not.toContain("choose the highest-impact screen yourself");
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
