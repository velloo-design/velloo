import { describe, expect, spyOn, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { displayPath, printExitInstructions, printSummary } from "../commands/init/output.ts";
import { redesignScreenScaffold } from "../scaffold/goal-scaffolds.ts";
import type { Scaffold } from "../scaffold/scaffold.ts";
import { buildPresetTheme } from "../scaffold/theme-presets.ts";
import type { WizardAnswers } from "../wizard/answers.ts";
import { planInstall } from "../wizard/provider-registry.ts";

/**
 * What init says last. The closing steps are where a person learns that the
 * design is not yet matched to their app — setup is named there exactly when
 * there is an app to match — and the summary's theme row is where they learn
 * what the design was actually themed from.
 */

function printed(run: () => void): string {
  const log = spyOn(console, "log").mockImplementation(() => {});
  try {
    run();
    return log.mock.calls.map((args) => args.join(" ")).join("\n");
  } finally {
    log.mockRestore();
  }
}

/** The numbered steps, as a person reads them down the page. */
function steps(out: string): string[] {
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^\d+\. /.test(line));
}

const folder = join(tmpdir(), "velloo-output-app", "velloo");
const NOT_WIRED = { wiredIds: [] };
const WIRED = { wiredIds: ["claude-code"] };

describe("init's closing steps", () => {
  test("with an app to match and no prompt to hand over, setup is its own step", () => {
    const out = printed(() => printExitInstructions(folder, NOT_WIRED, { setup: true }));
    expect(steps(out)).toEqual([
      `1. velloo connect ${folder} (wire your AI agent's MCP config + guidance)`,
      "2. Reload MCP in your AI agent (or restart it) so it loads the new config — it starts velloo itself.",
      "3. Ask your agent to set Velloo up for this app — /velloo:setup in Claude Code, or say it in any agent.",
      "4. velloo run (opens the canvas; o open, b background, q stop)",
    ]);
    // What setup does, so it is not skipped as optional housekeeping.
    expect(out).toContain("matches your theme and fonts");
    expect(out).toContain("checks that your components render");
    expect(out).toContain("design language for you to review on the canvas");
  });

  test("a handoff prompt already opens with the setup, so it is said once", () => {
    const out = printed(() =>
      printExitInstructions(folder, NOT_WIRED, { setup: true, handoff: true }),
    );
    expect(steps(out)[2]).toBe(
      "3. Give your agent the prompt above — it sets Velloo up for this app first, then starts on the design.",
    );
    expect(out).not.toContain("/velloo:setup");
    expect(steps(out)).toHaveLength(4);
  });

  test("with no app there is nothing to set up for, with a prompt or without", () => {
    const handoff = printed(() => printExitInstructions(folder, NOT_WIRED, { handoff: true }));
    expect(steps(handoff)[2]).toBe("3. Give your agent the prompt above.");
    expect(handoff).not.toMatch(/sets? Velloo up/i);

    const plain = printed(() => printExitInstructions(folder, NOT_WIRED));
    expect(steps(plain).map((step) => step.split(" ").slice(0, 3).join(" "))).toEqual([
      "1. velloo connect",
      "2. Reload MCP",
      "3. velloo run",
    ]);
    expect(plain).not.toMatch(/sets? Velloo up/i);
  });

  test("an agent that is already wired is not sent to connect, and the steps renumber", () => {
    const out = printed(() => printExitInstructions(folder, WIRED, { setup: true }));
    expect(out).not.toContain("velloo connect");
    expect(steps(out).map((step) => step.split(" ").slice(0, 4).join(" "))).toEqual([
      "1. Reload MCP in",
      "2. Ask your agent",
      "3. velloo run (opens",
    ]);
  });

  test("a cancelled wizard wrote no design, so there is none to set up", () => {
    const out = printed(() => printExitInstructions(undefined, NOT_WIRED, { setup: true }));
    expect(steps(out).map((step) => step.split(" ").slice(0, 3).join(" "))).toEqual([
      "1. velloo init",
      "2. velloo run",
      "3. velloo connect",
    ]);
    expect(out).not.toMatch(/sets? Velloo up/i);
    expect(out).not.toContain("README.md");
  });

  test("the README is named by the path a person can open from where they are", () => {
    const inside = printed(() => printExitInstructions(join(process.cwd(), "velloo"), WIRED));
    expect(inside).toContain(`Open ${join("velloo", "README.md")} for the full guide.`);
    // Outside the working directory an absolute path reads better than a climb of `../`.
    const outside = printed(() => printExitInstructions(folder, WIRED));
    expect(outside).toContain(`Open ${join(displayPath(folder), "README.md")} for the full guide.`);
  });
});

const appRoot = join(tmpdir(), "velloo-output-app");

function answers(overrides: Partial<WizardAnswers> = {}): WizardAnswers {
  return {
    appRoot,
    scanRoot: appRoot,
    folder,
    library: "none",
    source: "binary",
    componentsRelative: "src/components/ui",
    initialContent: "blank",
    ...overrides,
  };
}

const theme = buildPresetTheme("zinc");
const BLANK: Scaffold = {
  theme,
  screens: [],
  boards: [],
  snippets: [],
  annotations: [],
  notes: [],
};

function summary(
  overrides: Partial<WizardAnswers>,
  themeSource: Parameters<typeof printSummary>[4] = {},
  scaffold: Scaffold = BLANK,
): string {
  const a = answers(overrides);
  return printed(() => printSummary(folder, scaffold, planInstall(a), a, themeSource));
}

/** The value of one `Your setup` row. */
function row(out: string, label: string): string | undefined {
  const line = out.split("\n").find((l) => l.trim().startsWith(`${label} `));
  return line?.trim().slice(label.length).trim();
}

describe("init's summary", () => {
  test("the theme row says where the theme came from", () => {
    const sheet = join(appRoot, "src", "styles", "index.css");
    expect(row(summary({}, { importedFrom: sheet }), "Theme")).toBe(
      `imported from ${join("src", "styles", "index.css")}`,
    );
    expect(row(summary({}, { libraryDefaults: "Mantine" }), "Theme")).toBe(
      "Mantine's default theme",
    );
    // A stylesheet that was found and held nothing is not a choice of preset.
    expect(row(summary({}, { tokenlessStylesheet: sheet }), "Theme")).toBe(
      `Zinc (neutral) preset — no tokens found in ${join("src", "styles", "index.css")}`,
    );
  });

  test("with nothing imported it is the preset: neutral for an app, the sample's own for the sample", () => {
    expect(row(summary({}), "Theme")).toBe("Zinc (neutral)");
    expect(row(summary({ initialContent: "sample" }), "Theme")).toBe("Elsewhere");
    expect(row(summary({ themePreset: "rose" }), "Theme")).toBe("Rose");
  });

  test("an import outranks everything else that was found", () => {
    const sheet = join(appRoot, "app", "globals.css");
    const out = summary(
      {},
      { importedFrom: sheet, libraryDefaults: "Mantine", tokenlessStylesheet: sheet },
    );
    expect(row(out, "Theme")).toBe(`imported from ${join("app", "globals.css")}`);
  });

  test("the stack is shown where the design imports components, and its alias only for shadcn", () => {
    const shadcn = summary({ library: "shadcn-upstream", source: "in-repo", stack: "remix" });
    expect(row(shadcn, "Stack")).toBe("Remix / React Router (imports via ~/components/ui)");
    expect(shadcn).toContain("real shadcn lands in src/components/ui");
    expect(shadcn).toContain("nothing was written to your app");

    const mui = summary({ library: "mui", stack: "nextjs" });
    expect(row(mui, "Stack")).toBe("Next.js");
    expect(mui).not.toContain("imports via");

    // Native HTML imports nothing, so a stack would describe nothing.
    expect(row(summary({ library: "html", stack: "vite" }), "Stack")).toBeUndefined();
    expect(row(summary({ library: "none" }), "Stack")).toBeUndefined();
  });

  test("names the library the design is built on, and never one the app does not have", () => {
    const out = summary({ library: "none" });
    expect(row(out, "Library")).toContain("no-library primitives");
    expect(out).not.toContain("shadcn");
  });

  test("a blank start says so; a start with screens counts and names them", () => {
    expect(summary({})).toContain("Blank — no boards or screens yet.");

    const one = redesignScreenScaffold(theme, "Pricing");
    const first = one.screens[0];
    if (!first) throw new Error("the redesign scaffold has a screen");
    const many: Scaffold = {
      ...one,
      screens: Array.from({ length: 10 }, (_, i) => ({ ...first, id: `s${i}`, name: `S${i}` })),
    };
    const out = summary({ initialContent: "redesign-screen" }, {}, many);
    expect(out).toContain("10 screens across 1 board.");
    expect(out).toContain("S0, S1, S2, S3, S4, S5, S6, S7, +2 more");
    expect(out).not.toContain("Blank —");
    expect(out).not.toContain("Welcome sample");
  });
});
