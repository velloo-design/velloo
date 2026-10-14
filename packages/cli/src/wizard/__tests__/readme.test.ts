import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WizardAnswers } from "../answers.ts";
import { planInstall } from "../provider-registry.ts";
import { renderDesignReadme } from "../readme.ts";

/**
 * The README is what someone opens in the design folder a week after init, when
 * the closing steps have scrolled away. It says the same thing they did: where
 * there is an app, set the design up for it before the first design.
 */

let app: string;
beforeEach(async () => {
  app = await mkdtemp(join(tmpdir(), "velloo-readme-"));
});
afterEach(async () => {
  await rm(app, { recursive: true, force: true });
});

function readme(overrides: Partial<WizardAnswers> = {}, external = false): string {
  const answers: WizardAnswers = {
    appRoot: app,
    scanRoot: app,
    folder: join(app, "velloo"),
    library: "none",
    source: "binary",
    componentsRelative: "src/components/ui",
    initialContent: "blank",
    ...overrides,
  };
  return renderDesignReadme(answers, planInstall(answers), external);
}

const headings = (text: string) => text.split("\n").filter((line) => line.startsWith("## "));

describe("the design folder's README", () => {
  test("with an app, setup is the first thing after starting the canvas", async () => {
    await writeFile(join(app, "package.json"), JSON.stringify({ name: "app" }));
    const text = readme();
    expect(headings(text).slice(0, 3)).toEqual([
      "## Quick start",
      "## First: set it up for your app",
      "## Your setup",
    ]);
    const section = text.slice(
      text.indexOf("## First: set it up for your app"),
      text.indexOf("## Your setup"),
    );
    // The words the velloo-setup skill answers to, and the command that runs it.
    expect(section).toContain("**set Velloo up for this app**");
    expect(section).toContain("`/velloo:setup` in Claude Code");
    expect(section).toContain("in any other agent, say just that");
    // What it does, in the order it does it.
    const order = [
      "theme and real fonts",
      "components rendering",
      "checks every one",
      "proposes your design",
    ];
    const at = order.map((phrase) => section.indexOf(phrase));
    expect(at.every((index) => index >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(section).toContain("**Design\nlanguage**");
  });

  test("an app found by what it uses, not by a package.json, gets the same section", () => {
    const text = readme({
      library: "html",
      detected: { shadcn: false, tailwindMajor: null, uiLibrary: "html" },
    });
    expect(text).toContain("## First: set it up for your app");
  });

  test("with no app there is nothing to set up for, and the section is not there", () => {
    for (const initialContent of ["blank", "sample", "custom"] as const) {
      const text = readme({ initialContent, library: "shadcn-upstream", source: "in-repo" });
      expect(text).not.toContain("set it up for your app");
      expect(text).not.toContain("/velloo:setup");
      expect(headings(text).slice(0, 2)).toEqual(["## Quick start", "## Your setup"]);
    }
  });

  test("the setup table records the app, the library and how the design started", () => {
    const text = readme({ initialContent: "redesign-screen", screenName: "Pricing" });
    expect(text).toContain(`| App root | ${app} |`);
    expect(text).toContain("| Library | no-library primitives");
    expect(text).toContain("| Initial content | redesign screen (Pricing) |");
    expect(readme({ initialContent: "component", componentDescription: "sidebar" })).toContain(
      "| Initial content | component redesign (sidebar) |",
    );
    expect(readme({ initialContent: "custom" })).toContain("| Initial content | custom request |");
    expect(readme({ initialContent: "scan" })).toContain(
      "| Initial content | scanned from your app |",
    );
    expect(readme({ initialContent: "sample" })).toContain("| Initial content | Welcome sample |");
    expect(readme()).toContain("| Initial content | blank |");
  });

  test("a local design names the app symbolically: its path is this machine's, not the repo's", () => {
    const text = readme({ library: "shadcn-upstream", source: "in-repo" }, true);
    expect(text).toContain("| App root | app:. (local application binding) |");
    expect(text).toContain("| Components | app:src/components/ui |");
    expect(text).not.toContain(app);
  });
});
