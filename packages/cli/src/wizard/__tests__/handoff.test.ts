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
  // An app to match: what puts the setup first.
  detected: { shadcn: true, tailwindMajor: 4, uiLibrary: "shadcn" },
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
      expect(prompt.length).toBeLessThan(400);
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
      expect(prompt).toContain("don't stop below 0.9");
    }
  });

  test("redesign-screen handoff asks to recreate then explore alternatives", () => {
    const prompt = buildHandoffPrompt(
      { ...BASE, initialContent: "redesign-screen", screenName: "Pricing" },
      [screen("pricing", "Pricing")],
    );
    expect(prompt).toContain("**Pricing**");
    expect(prompt.split("\n")).toEqual([
      "Use Velloo to redesign **Pricing**:",
      "1. Set Velloo up for my app (theme, fonts, components) before anything else.",
      "2. Recreate the whole real page on its scaffolded screen — keep fixing `compare_to_url`'s top mismatches and don't stop below 0.9. Start the app yourself.",
      "3. Explore a few different directions beside it on the same board.",
    ]);
  });

  test("the prompt names no library: the session's brief says what the design is built on", () => {
    for (const initialContent of ["scan", "redesign-screen", "component", "custom"] as const) {
      const prompt = buildHandoffPrompt(
        { ...BASE, initialContent, customRequest: "a pricing page" },
        [screen("a", "A")],
      );
      expect(prompt).not.toMatch(/shadcn|primitives|components\b(?!\))/);
    }
  });

  test("with no app there is nothing to set Velloo up for, and the steps close up", () => {
    const { detected: _, ...noApp } = BASE;
    const prompt = buildHandoffPrompt({ ...noApp, initialContent: "component" }, []);
    expect(prompt).not.toContain("Set Velloo up");
    expect(prompt).toContain("1. Recreate it");
    expect(prompt).toContain("2. Explore");
  });

  test("a custom request in an app runs the setup first, a capture included", () => {
    const custom = { ...BASE, initialContent: "custom" as const, customRequest: "a pricing page" };
    expect(buildHandoffPrompt(custom, [])).toContain("1. Set Velloo up for my app");
    const captured = buildHandoffPrompt({ ...custom, captureUrl: "https://example.com" }, []);
    expect(captured).toContain("1. Set Velloo up for my app");
    expect(captured).toContain("2. Capture https://example.com with `start_capture_session`");
    expect(captured).toContain("3. Design it");
  });

  test("component handoff embeds the description", () => {
    const prompt = buildHandoffPrompt(
      { ...BASE, initialContent: "component", componentDescription: "sidebar nav" },
      [],
    );
    expect(prompt).toContain("sidebar nav");
    expect(prompt).toContain("3. Explore a few different directions beside it");
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
