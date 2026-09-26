import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as clack from "@clack/prompts";

/**
 * The wizard's DESIGN.md offer. The question has to carry what the user needs
 * to decide — which system, how much of it maps — and when little maps, the
 * stylesheet is what Enter picks.
 */

interface SelectCall {
  message: string;
  options: { value: boolean; label: string; hint?: string }[];
  initialValue: boolean;
}

const selects: SelectCall[] = [];
const infos: string[] = [];
let answer: boolean | symbol = true;

mock.module("@clack/prompts", () => ({
  ...clack,
  select: async (opts: SelectCall) => {
    selects.push(opts);
    return answer;
  },
  log: { ...clack.log, info: (message: string) => infos.push(message) },
  isCancel: (value: unknown) => typeof value === "symbol",
}));

const { promptDesignMd } = await import("../design-md-prompt.ts");

const FULL = `---
name: Paws & Paths
colors:
  background: "#f9f9ff"
  foreground: "#151c27"
  primary: "#855300"
  primary-foreground: "#ffffff"
  secondary: "#555555"
  secondary-foreground: "#ffffff"
  muted: "#eeeeee"
  muted-foreground: "#666666"
  accent: "#ffcc00"
  accent-foreground: "#000000"
  destructive: "#ba1a1a"
  destructive-foreground: "#ffffff"
  card: "#ffffff"
  card-foreground: "#151c27"
  popover: "#ffffff"
  popover-foreground: "#151c27"
  border: "#867461"
  input: "#867461"
  ring: "#855300"
---
`;

/** Names one role velloo knows; the rest are a vocabulary it does not. */
const WEAK = `---
name: Sparse
colors:
  primary: "#855300"
  sky-blue: "#88ccff"
---
`;

let app: string;
beforeEach(async () => {
  app = await mkdtemp(join(tmpdir(), "velloo-designmd-prompt-"));
  selects.length = 0;
  infos.length = 0;
  answer = true;
});
afterEach(async () => {
  await rm(app, { recursive: true, force: true });
});

async function detected(source: string, globals = true) {
  await writeFile(join(app, "DESIGN.md"), source, "utf8");
  if (globals) await writeFile(join(app, "globals.css"), ":root{}", "utf8");
  return {
    shadcn: false,
    tailwindMajor: 4 as const,
    designMdPath: join(app, "DESIGN.md"),
    ...(globals ? { globalsCssPath: join(app, "globals.css") } : {}),
  };
}

describe("promptDesignMd", () => {
  test("nothing detected ⇒ no question", async () => {
    expect(
      await promptDesignMd({ shadcn: false, tailwindMajor: 4 }, app, undefined),
    ).toBeUndefined();
    expect(selects).toHaveLength(0);
  });

  test("names the system and its coverage, and defaults to it when it maps well", async () => {
    expect(await promptDesignMd(await detected(FULL), app, undefined)).toBe(true);
    const call = selects[0] as SelectCall;
    expect(call.message).toContain('"Paws & Paths"');
    expect(call.message).toMatch(/names (\d+) of the \1 color roles/);
    expect(call.options[1]?.label).toContain("globals.css");
    expect(call.initialValue).toBe(true);
  });

  test("low coverage pre-selects the stylesheet and says why", async () => {
    answer = false;
    expect(await promptDesignMd(await detected(WEAK), app, undefined)).toBe(false);
    const call = selects[0] as SelectCall;
    expect(call.initialValue).toBe(false);
    expect(call.options[1]?.hint).toContain("maps few roles");
  });

  test("low coverage with no stylesheet still defaults to the DESIGN.md over a preset", async () => {
    await promptDesignMd(await detected(WEAK, false), app, undefined);
    const call = selects[0] as SelectCall;
    expect(call.options[1]?.label).toBe("Use a preset");
    expect(call.initialValue).toBe(true);
  });

  test("a file with no mappable colors is not offered, and says the prose is still followed", async () => {
    const prose =
      "# Acme\n\n## Overview\n\nCalm.\n\n## Colors\n\nOne accent.\n\n## Typography\n\nInter.\n";
    expect(await promptDesignMd(await detected(prose), app, undefined)).toBeUndefined();
    expect(selects).toHaveLength(0);
    expect(infos.join(" ")).toContain("still follow its prose");
  });

  test("cancel ⇒ null", async () => {
    answer = Symbol("cancel");
    expect(await promptDesignMd(await detected(FULL), app, undefined)).toBeNull();
  });
});
