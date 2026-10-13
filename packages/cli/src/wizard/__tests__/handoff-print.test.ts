import { describe, expect, spyOn, test } from "bun:test";
import type { Screen } from "@velloo/schema";
import type { WizardAnswers } from "../answers.ts";
import { SCREENS_PLACEHOLDER } from "../handoff.ts";
import { printAgentHandoff } from "../handoff-print.ts";

/**
 * What init prints for the agent when it is not a terminal's to launch one:
 * the prompt, whole, under a heading that says what it is for. For a design
 * bound to an app the prompt opens with the setup.
 */

const BOUND: WizardAnswers = {
  appRoot: "/home/me/proj",
  scanRoot: "/home/me/proj",
  folder: "/home/me/proj/velloo",
  library: "none",
  source: "binary",
  componentsRelative: "src/components/ui",
  initialContent: "redesign-screen",
  screenName: "Pricing",
  detected: { shadcn: false, tailwindMajor: 4, unsupportedUi: "Mantine" },
};

const screen = (id: string, name: string): Screen => ({ id, name, tree: { $ref: "Box" } });

async function printed(answers: WizardAnswers, screens: Screen[] = []): Promise<string[]> {
  const log = spyOn(console, "log").mockImplementation(() => {});
  try {
    await printAgentHandoff(answers, { screens }, false, []);
    return log.mock.calls.map((args) => args.join(" "));
  } finally {
    log.mockRestore();
  }
}

describe("the handoff init prints", () => {
  test("for a bound app: the prompt to paste, opening with the setup", async () => {
    const lines = await printed(BOUND, [screen("pricing", "Pricing")]);
    expect(lines.slice(0, 3)).toEqual([
      "  Start your agent",
      "    Paste this to your AI agent:",
      "",
    ]);
    expect(lines.slice(3, 7)).toEqual([
      "    Use Velloo to redesign **Pricing**:",
      "    1. Set Velloo up for my app (theme, fonts, components).",
      "    2. Recreate the whole real page on its scaffolded screen — keep fixing `compare_to_url`'s top mismatches and don't stop below 0.9. Start the app yourself.",
      "    3. Explore a few different directions beside it on the same board.",
    ]);
    // The session's brief says what the design is built on; the prompt does not guess.
    expect(lines.join("\n")).not.toMatch(/shadcn|Mantine|primitives/);
  });

  test("with no app the same goal is handed over without a setup step", async () => {
    const { detected: _, ...unbound } = BOUND;
    const text = (await printed(unbound)).join("\n");
    expect(text).toContain("Start your agent");
    expect(text).toContain("1. Recreate the whole real page");
    expect(text).not.toContain("Set Velloo up");
  });

  test("a scan's screen list stays a placeholder, and says what replaces it", async () => {
    const lines = await printed({ ...BOUND, initialContent: "scan" }, [
      screen("index", "Home"),
      screen("pricing", "Pricing"),
    ]);
    expect(lines).toContain(`    ${SCREENS_PLACEHOLDER}`);
    expect(lines.join("\n")).toContain(
      `${SCREENS_PLACEHOLDER} is replaced with your selected screens when the prompt is sent`,
    );
    expect(lines.join("\n")).not.toContain("- Home");
  });

  test("the starts that stand on their own print no prompt at all", async () => {
    for (const initialContent of ["blank", "sample"] as const) {
      expect(await printed({ ...BOUND, initialContent })).toEqual([]);
    }
  });
});
