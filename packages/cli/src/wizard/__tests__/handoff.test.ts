import { describe, expect, test } from "bun:test";
import type { Screen } from "@velloo/schema";
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

describe("buildHandoffPrompt", () => {
  test("lists screens as a placeholder, not inline", () => {
    const prompt = buildHandoffPrompt(BASE, [screen("index", "Home"), screen("about", "About")]);
    expect(prompt).toContain(SCREENS_PLACEHOLDER);
    expect(prompt).not.toContain("- Home");
  });

  test("states the goal only: how to work in Velloo ships in the MCP instructions", () => {
    for (const initialContent of ["scan", "redesign-screen", "component", "custom"] as const) {
      const prompt = buildHandoffPrompt(
        { ...BASE, initialContent, customRequest: "a pricing page" },
        [screen("a", "A")],
      );
      expect(prompt.length).toBeLessThan(500);
      for (const detail of ["topMismatches", "preview_status", "velloo-setup", "by hand"]) {
        expect(prompt).not.toContain(detail);
      }
    }
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
    const prompt = buildHandoffPrompt(answers, [screen("web-index", "Web / Home")]);
    expect(prompt).toContain("monorepo with 2 apps");
    expect(prompt).toContain("`apps/web`");
    expect(prompt).toContain("`apps/admin`");
    expect(prompt).not.toContain("The app lives in");
  });

  test("every start from an existing app says the agent runs the app itself, with a bar to reach", () => {
    for (const initialContent of ["scan", "redesign-screen", "component"] as const) {
      const prompt = buildHandoffPrompt({ ...BASE, initialContent }, [screen("a", "A")]);
      expect(prompt).toContain("Start the app yourself");
      expect(prompt).toContain("Velloo never runs it");
      expect(prompt).toContain("don't stop below 0.9");
    }
  });

  test("redesign-screen handoff asks to recreate then explore alternatives", () => {
    const prompt = buildHandoffPrompt(
      { ...BASE, initialContent: "redesign-screen", screenName: "Pricing" },
      [screen("pricing", "Pricing")],
    );
    expect(prompt).toContain("**Pricing**");
    expect(prompt).toContain(
      "1. Match my app's theme and fonts, then recreate the whole real page",
    );
    expect(prompt).toContain("2. Then explore a few different directions");
    expect(prompt).toContain("different directions side by side");
    expect(prompt).toContain("my shadcn components");
  });

  test("component handoff embeds the description", () => {
    const prompt = buildHandoffPrompt(
      { ...BASE, initialContent: "component", componentDescription: "sidebar nav" },
      [],
    );
    expect(prompt).toContain("sidebar nav");
    expect(prompt).toContain("different directions side by side");
  });

  test("custom handoff embeds the request", () => {
    const prompt = buildHandoffPrompt(
      { ...BASE, initialContent: "custom", customRequest: "a playful onboarding flow" },
      [],
    );
    expect(prompt).toContain("a playful onboarding flow");
    expect(prompt).not.toContain("start_capture_session");
  });

  test("a custom request based on a live site opens by capturing it", () => {
    const prompt = buildHandoffPrompt(
      {
        ...BASE,
        initialContent: "custom",
        customRequest: "a calmer dashboard",
        captureUrl: "https://example.com/app",
      },
      [],
    );
    expect(prompt).toContain("https://example.com/app");
    expect(prompt).toContain("start_capture_session");
  });

  test("an app on a framework without an adapter builds with its own components", () => {
    const prompt = buildHandoffPrompt(
      {
        ...BASE,
        library: "none",
        initialContent: "redesign-screen",
        detected: { unsupportedUi: "Mantine" } as WizardAnswers["detected"],
      },
      [screen("a", "A")],
    );
    expect(prompt).toContain("my own Mantine components");
  });

  test("the self-contained starts get no handoff at all", () => {
    for (const initialContent of ["sample", "blank"] as InitialContent[]) {
      expect(wantsHandoff({ ...BASE, initialContent })).toBe(false);
    }
  });
});

describe("expandHandoffPrompt", () => {
  test("replaces the placeholder with one bullet per screen", () => {
    const prompt = buildHandoffPrompt(BASE, [screen("index", "Home"), screen("about", "About")]);
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
