import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as clack from "@clack/prompts";
import type { GoalMode, WizardAnswers } from "../answers.ts";
import type { WizardContext } from "../prompt-kit.ts";

/**
 * The wizard never asks what the app can answer. With an app in the directory
 * its library is read from it — the framework it uses, else the no-library
 * provider, never one it does not have — and so is where its components are.
 * The library is a question only when there is no app to read.
 *
 * Every prompt is answered from `replies`, and a question nobody scripted
 * throws: a prompt that comes back is a failure, not an unnoticed extra line.
 */

interface Asked {
  kind: "select" | "text";
  question: string;
  options?: string[];
  initialValue?: unknown;
}

const asked: Asked[] = [];
const notes: { title: string; body: string }[] = [];
const spins: string[] = [];
let replies: Record<string, unknown> = {};

/** A prompt's first line; the rest is its dim subtitle. */
const questionOf = (message: string): string => message.split("\n")[0] ?? message;

function reply(question: string): unknown {
  if (!(question in replies)) throw new Error(`the wizard asked: ${question}`);
  return replies[question];
}

mock.module("@clack/prompts", () => ({
  ...clack,
  select: async (opts: {
    message: string;
    options: { value: unknown }[];
    initialValue?: unknown;
  }) => {
    const question = questionOf(opts.message);
    asked.push({
      kind: "select",
      question,
      options: opts.options.map((option) => String(option.value)),
      initialValue: opts.initialValue,
    });
    return reply(question);
  },
  text: async (opts: { message: string }) => {
    const question = questionOf(opts.message);
    asked.push({ kind: "text", question });
    return reply(question);
  },
  note: (body: string, title: string) => {
    notes.push({ title, body });
  },
  spinner: () => ({
    start: () => {},
    stop: (message: string) => {
      spins.push(message);
    },
    message: () => {},
  }),
  log: { ...clack.log, info: () => {}, warn: () => {} },
  cancel: () => {},
  isCancel: (value: unknown) => typeof value === "symbol",
}));

const { runInteractive } = await import("../prompts.ts");

const START = "How do you want to start your board?";
const LIBRARY = "Component library";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "velloo-wizard-"));
  asked.length = 0;
  notes.length = 0;
  spins.length = 0;
  replies = {};
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function write(rel: string, body: string): Promise<void> {
  const abs = join(root, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, body, "utf8");
}

/**
 * A directory the wizard runs in. Its `velloo.json` already answers the
 * feedback question, which is what keeps the sharing step from signing in.
 */
async function directory(files: Record<string, string> = {}): Promise<string> {
  await write("velloo.json", JSON.stringify({ designs: [], feedback: { enabled: false } }));
  for (const [rel, body] of Object.entries(files)) await write(rel, body);
  return root;
}

const pkg = (dependencies: Record<string, string>, devDependencies: Record<string, string> = {}) =>
  JSON.stringify({ dependencies: { react: "^19.0.0", ...dependencies }, devDependencies });

const PAGE = "export default function Page() { return null; }\n";

async function wizard(
  goal: GoalMode,
  more: Record<string, unknown> = {},
  ctx: Partial<WizardContext> = {},
): Promise<WizardAnswers> {
  replies = { [START]: goal, ...more };
  const outcome = await runInteractive({
    appRoot: root,
    connectEnabled: false,
    presetFolder: "velloo",
    ...ctx,
  });
  if (outcome.status !== "ok") throw new Error("the wizard was cancelled");
  return outcome.answers;
}

const questions = () => asked.map((prompt) => prompt.question);

describe("an app settles its own library", () => {
  test("an app with no UI library is a no-library design, and shadcn is never offered", async () => {
    await directory({
      "package.json": pkg({}, { tailwindcss: "^4.2.2" }),
      "src/App.tsx": "export default () => <main />;\n",
    });
    const goals: [GoalMode, Record<string, unknown>, string[]][] = [
      ["blank", {}, [START]],
      [
        "custom",
        { "What design do you need?": "a pricing page" },
        [START, "What design do you need?"],
      ],
      [
        "redesign-component",
        { "Component name or description": "sidebar" },
        [START, "Component name or description"],
      ],
    ];
    for (const [goal, more, expected] of goals) {
      asked.length = 0;
      const answers = await wizard(goal, more);
      expect(answers.library).toBe("none");
      expect(answers.source).toBe("binary");
      // The start menu and the brief for it: no library, no components folder.
      expect(questions()).toEqual(expected);
      for (const prompt of asked) expect(prompt.options ?? []).not.toContain("shadcn-upstream");
    }
    expect(spins.every((message) => message.startsWith("No UI library detected"))).toBe(true);
    expect(spins).toHaveLength(goals.length);
  });

  test("the welcome sample in such an app is shadcn's, the library it was made with, unasked", async () => {
    await directory({
      "package.json": pkg({}, { tailwindcss: "^4.2.2" }),
      "src/App.tsx": "export default () => <main />;\n",
    });
    const sample = await wizard("sample");
    expect(sample.library).toBe("shadcn-upstream");
    expect(sample.source).toBe("in-repo");
    expect(questions()).toEqual([START]);
    expect(spins).toEqual([
      "No UI library detected — the welcome sample is composed with shadcn, the library it was made with.",
    ]);
    // It keeps its own theme, so nothing of the app's is carried along to import.
    expect(sample.detected).toBeUndefined();
  });

  test("a sample is composed for the app's library, read where the app is", async () => {
    await directory({
      "package.json": JSON.stringify({ name: "repo", workspaces: ["apps/*"] }),
      "apps/web/package.json": pkg({ "@mantine/core": "^8.0.0" }),
    });
    const sample = await wizard("sample");
    // Mantine has no adapter and no sample of its own: Velloo's primitives stand in.
    expect(sample.library).toBe("none");
    expect(sample.scanRoot).toBe(join(root, "apps", "web"));
    expect(questions()).toEqual([START]);
  });

  test("what the wizard shows for such an app promises nothing it does not have", async () => {
    await directory({ "package.json": pkg({}) });
    const answers = await wizard("blank");
    const detected = notes.find((note) => note.title === "Detected in your app");
    expect(detected?.body).toContain("UI library: none detected");
    expect(detected?.body).not.toContain("shadcn");
    expect(notes.find((note) => note.title === "Library")?.body).toBe("Using No library.");
    // Carried along, so init imports the app's theme and names setup as the first step.
    expect(answers.detected).toMatchObject({ shadcn: false });
    expect(answers.initialContent).toBe("blank");
  });

  test("the framework the app uses is the design's, without a question", async () => {
    const apps: [Record<string, string>, WizardAnswers["library"], WizardAnswers["source"]][] = [
      [{ "package.json": pkg({ "@mui/material": "^6.0.0" }) }, "mui", "binary"],
      [{ "package.json": pkg({ antd: "^5.0.0" }) }, "antd", "binary"],
      [{ "package.json": pkg({ "@chakra-ui/react": "^2.0.0" }) }, "chakra", "binary"],
      [
        { "package.json": pkg({}), "components.json": JSON.stringify({ style: "new-york" }) },
        "shadcn-upstream",
        "in-repo",
      ],
    ];
    for (const [files, library, source] of apps) {
      await rm(root, { recursive: true, force: true });
      await directory(files);
      for (const goal of ["blank", "sample"] as const) {
        asked.length = 0;
        const answers = await wizard(goal);
        expect(answers.library).toBe(library);
        expect(answers.source).toBe(source);
        expect(questions()).toEqual([START]);
      }
    }
  });

  test("a framework with no adapter is a no-library design that says which framework", async () => {
    await directory({ "package.json": pkg({ "@mantine/core": "^8.0.0" }) });
    const answers = await wizard("custom", { "What design do you need?": "a billing page" });
    expect(answers.library).toBe("none");
    expect(answers.detected?.unsupportedUi).toBe("Mantine");
    expect(answers.customRequest).toBe("a billing page");
    expect(notes.find((note) => note.title === "Detected in your app")?.body).toContain(
      "Mantine (no Velloo adapter yet)",
    );
    expect(questions()).not.toContain(LIBRARY);
  });

  test("an explicit --library is kept, and the app is not read to second-guess it", async () => {
    await directory({ "package.json": pkg({ "@mui/material": "^6.0.0" }) });
    const answers = await wizard("blank", {}, { pinnedLibrary: "shadcn-upstream" });
    expect(answers.library).toBe("shadcn-upstream");
    expect(answers.source).toBe("in-repo");
    expect(questions()).toEqual([START]);
    expect(spins).toEqual([]);
  });
});

describe("redesigning a screen", () => {
  const SCREEN = "Which screen should your agent redesign?";

  async function nextApp(dependencies: Record<string, string> = {}): Promise<void> {
    await directory({
      "package.json": pkg({ next: "15.0.0", ...dependencies }),
      "app/page.tsx": PAGE,
      "app/pricing/page.tsx": PAGE,
    });
  }

  test("a screen picked from the app's routes brings the app's library and stack with it", async () => {
    await nextApp({ "@mui/material": "^6.0.0" });
    const answers = await wizard("redesign-screen", {
      [SCREEN]: "scan",
      "Which screen?": "pricing",
    });
    expect(questions()).toEqual([START, SCREEN, "Which screen?"]);
    expect(asked[2]?.options?.sort()).toEqual(["index", "pricing"]);
    expect(answers).toMatchObject({
      initialContent: "redesign-screen",
      library: "mui",
      source: "binary",
      screenName: "Pricing",
      stack: "nextjs",
      scanRoot: root,
    });
    expect(answers.selectedRoutes?.map((route) => route.id)).toEqual(["pricing"]);
    expect(answers.detected?.uiLibrary).toBe("mui");
  });

  test("a picked screen in an app with no UI library is a no-library design", async () => {
    await nextApp();
    const answers = await wizard("redesign-screen", { [SCREEN]: "scan", "Which screen?": "index" });
    expect(answers.library).toBe("none");
    expect(questions()).not.toContain(LIBRARY);
  });

  test("a screen that is only named still has its library read from the app", async () => {
    await nextApp({ "@mui/material": "^6.0.0" });
    const answers = await wizard("redesign-screen", {
      [SCREEN]: "type",
      "Screen name": " Checkout ",
    });
    expect(questions()).toEqual([START, SCREEN, "Screen name"]);
    expect(answers.screenName).toBe("Checkout");
    expect(answers.selectedRoutes).toBeUndefined();
    expect(answers.library).toBe("mui");
    expect(answers.stack).toBe("nextjs");
    expect(answers.detected?.uiLibrary).toBe("mui");
  });

  test("an app with no routes to pick from asks for a name, and nothing about the library", async () => {
    await directory({ "package.json": pkg({}), "src/App.tsx": "export default () => <main />;\n" });
    const answers = await wizard("redesign-screen", { [SCREEN]: "scan", "Screen name": "Pricing" });
    expect(questions()).toEqual([START, SCREEN, "Screen name"]);
    expect(spins[0]).toBe("No routes detected — type a screen name instead.");
    expect(answers.library).toBe("none");
    expect(answers.screenName).toBe("Pricing");
  });

  test("--library outranks what the picked screen's app uses", async () => {
    await nextApp({ "@mui/material": "^6.0.0" });
    const answers = await wizard(
      "redesign-screen",
      { [SCREEN]: "scan", "Which screen?": "index" },
      { pinnedLibrary: "none" },
    );
    expect(answers.library).toBe("none");
    // Still the app the theme is imported from.
    expect(answers.detected?.uiLibrary).toBe("mui");
  });
});

describe("with no app to read, the library is the one question left", () => {
  test("the start menu narrows to the starts that need no app, and the library is asked", async () => {
    await directory();
    const blank = await wizard("blank", { [LIBRARY]: "mui" });
    expect(asked[0]?.options).toEqual(["capture-site", "sample", "blank"]);
    expect(questions()).toEqual([START, LIBRARY]);
    expect(blank.library).toBe("mui");
    expect(blank.detected).toBeUndefined();
    // Blank is the trivial end: its answer on Enter is the no-library provider.
    expect(asked[1]?.initialValue).toBe("none");
    expect(asked[1]?.options).toContain("shadcn-upstream");
    expect(spins).toEqual(["No app found here — you'll pick a library next."]);

    asked.length = 0;
    const sample = await wizard("sample", { [LIBRARY]: "shadcn-upstream" });
    expect(questions()).toEqual([START, LIBRARY]);
    expect(asked[1]?.initialValue).toBe("shadcn-upstream");
    expect(sample.library).toBe("shadcn-upstream");
    expect(sample.source).toBe("in-repo");
  });

  test("a design from a live site has no app either, so its library is asked too", async () => {
    await directory();
    const answers = await wizard("capture-site", {
      "Site to design from": "https://app.example.com/dashboard",
      [LIBRARY]: "none",
    });
    expect(questions()).toEqual([START, "Site to design from", LIBRARY]);
    expect(answers.captureUrl).toBe("https://app.example.com/dashboard");
    expect(answers.initialContent).toBe("custom");
    expect(answers.library).toBe("none");
  });

  test("--library answers it up front", async () => {
    await directory();
    const answers = await wizard("blank", {}, { pinnedLibrary: "antd" });
    expect(questions()).toEqual([START]);
    expect(answers.library).toBe("antd");
  });

  test("backing out of the library question writes nothing", async () => {
    await directory();
    replies = { [START]: "blank", [LIBRARY]: Symbol("cancel") };
    const outcome = await runInteractive({
      appRoot: root,
      connectEnabled: false,
      presetFolder: "velloo",
    });
    expect(outcome.status).toBe("abort");
  });
});

describe("where the components are is found, never asked", () => {
  test("the directory the app keeps them in is recorded for every start", async () => {
    await directory({ "package.json": pkg({}), "components/ui/button.tsx": PAGE });
    const starts: [GoalMode, Record<string, unknown>][] = [
      ["blank", {}],
      ["sample", {}],
      ["custom", { "What design do you need?": "a pricing page" }],
    ];
    for (const [goal, more] of starts) {
      asked.length = 0;
      expect((await wizard(goal, more)).componentsRelative).toBe("components/ui");
      expect(asked.filter((prompt) => prompt.kind === "text").map((p) => p.question)).toEqual(
        Object.keys(more),
      );
    }
  });

  test("an app with none of the usual directories gets the conventional path", async () => {
    await directory({ "package.json": pkg({}) });
    expect((await wizard("blank")).componentsRelative).toBe("src/components/ui");
  });

  test("in a monorepo it is under the app, and so is everything read from the app", async () => {
    await directory({
      "package.json": JSON.stringify({ name: "repo", workspaces: ["apps/*"] }),
      "apps/web/package.json": pkg({ "@mui/material": "^6.0.0" }),
      "apps/web/components/ui/button.tsx": PAGE,
    });
    const web = join(root, "apps", "web");
    const blank = await wizard("blank");
    expect(blank).toMatchObject({
      library: "mui",
      scanRoot: web,
      componentsRelative: "apps/web/components/ui",
    });

    const custom = await wizard("custom", { "What design do you need?": "a pricing page" });
    expect(custom).toMatchObject({
      library: "mui",
      scanRoot: web,
      componentsRelative: "apps/web/components/ui",
    });
  });

  test("a second design in the repo keeps the first one's answer", async () => {
    await directory({ "package.json": pkg({}), "components/ui/button.tsx": PAGE });
    for (const goal of ["blank", "sample"] as const) {
      const answers = await wizard(goal, {}, { inheritComponentsDir: "src/ui" });
      expect(answers.componentsRelative).toBe("src/ui");
    }
  });
});
