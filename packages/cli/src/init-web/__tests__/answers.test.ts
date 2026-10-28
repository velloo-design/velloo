import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { InitCreateBody, InitGoal } from "@velloo/protocol/init";
import type { WizardAnswers } from "../../wizard/answers.ts";
import { answersFor, type InitRun, placeFor } from "../answers.ts";
import { describeApp, readApp } from "../read-app.ts";

/**
 * The page asks only what the app can't answer. With an app in the directory
 * its library is read from it — the framework it uses, else the no-library
 * provider, never one it does not have — and so is where its components are.
 * The library is a choice only when there is no app to read.
 */

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "velloo-init-web-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function write(rel: string, body: string): Promise<void> {
  const abs = join(root, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, body, "utf8");
}

async function directory(files: Record<string, string> = {}): Promise<void> {
  for (const [rel, body] of Object.entries(files)) await write(rel, body);
}

const pkg = (dependencies: Record<string, string>, devDependencies: Record<string, string> = {}) =>
  JSON.stringify({ dependencies: { react: "^19.0.0", ...dependencies }, devDependencies });

const PAGE = "export default function Page() { return null; }\n";

const run = (more: Partial<InitRun> = {}): InitRun => ({
  launchRoot: root,
  secondFolder: false,
  managedId: "m1",
  managedFolder: join(root, "..", "managed", "m1"),
  ...more,
});

async function answers(
  goal: InitGoal,
  more: Partial<InitCreateBody> = {},
  runMore: Partial<InitRun> = {},
): Promise<WizardAnswers> {
  const reading = await readApp(root);
  const built = answersFor(
    { appRoot: root, storage: "repository", goal, agents: [], ...more },
    reading,
    join(root, "velloo"),
    run(runMore),
  );
  if ("problem" in built) throw new Error(built.problem);
  return built.answers;
}

describe("an app settles its own library", () => {
  test("an app with no UI library is a no-library design", async () => {
    await directory({
      "package.json": pkg({}, { tailwindcss: "^4.2.2" }),
      "src/App.tsx": "export default () => <main />;\n",
    });
    for (const [goal, more] of [
      ["blank", {}],
      ["custom", { request: "a pricing page" }],
      ["redesign-component", { component: "sidebar" }],
    ] as const) {
      const built = await answers(goal, more);
      expect(built.library).toBe("none");
      expect(built.source).toBe("binary");
    }
    const app = describeApp(root, await readApp(root));
    expect(app.found).toBe(true);
    expect(app.library.id).toBe("none");
    expect(app.libraryNote).toContain("the setup step finds the components your app has");
  });

  test("the welcome sample in such an app is shadcn's, and carries nothing of the app's", async () => {
    await directory({ "package.json": pkg({}), "src/App.tsx": "export default () => <main />;\n" });
    const sample = await answers("sample");
    expect(sample.library).toBe("shadcn-upstream");
    expect(sample.source).toBe("in-repo");
    expect(sample.detected).toBeUndefined();
    expect(sample.themePreset).toBe("elsewhere");
  });

  test("the framework the app uses is the design's", async () => {
    const apps: [Record<string, string>, WizardAnswers["library"]][] = [
      [{ "package.json": pkg({ "@mui/material": "^6.0.0" }) }, "mui"],
      [{ "package.json": pkg({ antd: "^5.0.0" }) }, "antd"],
      [
        { "package.json": pkg({}), "components.json": JSON.stringify({ style: "new-york" }) },
        "shadcn-upstream",
      ],
    ];
    for (const [files, library] of apps) {
      await rm(root, { recursive: true, force: true });
      await directory(files);
      for (const goal of ["blank", "sample"] as const) {
        expect((await answers(goal)).library).toBe(library);
      }
    }
  });

  test("a library the page sends is ignored when the app settles it", async () => {
    await directory({ "package.json": pkg({ "@mui/material": "^6.0.0" }) });
    expect((await answers("blank", { library: "antd" })).library).toBe("mui");
  });

  test("a framework with no adapter is a no-library design that says which", async () => {
    await directory({ "package.json": pkg({ "@mantine/core": "^8.0.0" }) });
    const built = await answers("custom", { request: "a billing page" });
    expect(built.library).toBe("none");
    expect(built.detected?.unsupportedUi).toBe("Mantine");
    expect(describeApp(root, await readApp(root)).uiLibrary).toBe("Mantine");
  });

  test("an explicit --library is kept", async () => {
    await directory({ "package.json": pkg({ "@mui/material": "^6.0.0" }) });
    const built = await answers("blank", {}, { pinnedLibrary: "shadcn-upstream" });
    expect(built.library).toBe("shadcn-upstream");
    expect(built.source).toBe("in-repo");
  });
});

describe("redesigning a screen", () => {
  async function nextApp(dependencies: Record<string, string> = {}): Promise<void> {
    await directory({
      "package.json": pkg({ next: "15.0.0", ...dependencies }),
      "app/page.tsx": PAGE,
      "app/pricing/page.tsx": PAGE,
    });
  }

  test("the app's routes are offered, and a picked one brings its library and stack", async () => {
    await nextApp({ "@mui/material": "^6.0.0" });
    const app = describeApp(root, await readApp(root));
    expect(app.routes.map((r) => r.id).sort()).toEqual(["index", "pricing"]);
    const built = await answers("redesign-screen", { routeId: "pricing" });
    expect(built).toMatchObject({
      initialContent: "redesign-screen",
      library: "mui",
      screenName: "Pricing",
      stack: "nextjs",
      scanRoot: root,
    });
    expect(built.selectedRoutes?.map((r) => r.id)).toEqual(["pricing"]);
  });

  test("a screen the app doesn't have is named, and the library still comes from the app", async () => {
    await nextApp({ "@mui/material": "^6.0.0" });
    const built = await answers("redesign-screen", { screenName: " Checkout " });
    expect(built.screenName).toBe("Checkout");
    expect(built.selectedRoutes).toBeUndefined();
    expect(built.library).toBe("mui");
  });

  test("with neither a route nor a name there is nothing to redesign", async () => {
    await nextApp();
    const built = answersFor(
      { appRoot: root, storage: "repository", goal: "redesign-screen", agents: [] },
      await readApp(root),
      join(root, "velloo"),
      run(),
    );
    expect(built).toEqual({ problem: "Pick one of your app's screens, or name one." });
  });
});

describe("with no app to read, the library is the one choice left", () => {
  test("the page's choice is used, and blank falls back to the no-library provider", async () => {
    expect(describeApp(root, await readApp(root)).found).toBe(false);
    expect((await answers("blank", { library: "mui" })).library).toBe("mui");
    expect((await answers("blank")).library).toBe("none");
    const sample = await answers("sample");
    expect(sample.library).toBe("shadcn-upstream");
  });

  test("a design from a live site needs an http(s) URL", async () => {
    const built = await answers("capture-site", { captureUrl: "https://app.example.com/x" });
    expect(built.captureUrl).toBe("https://app.example.com/x");
    expect(built.initialContent).toBe("custom");
    const bad = answersFor(
      {
        appRoot: root,
        storage: "repository",
        goal: "capture-site",
        captureUrl: "ftp://x",
        agents: [],
      },
      await readApp(root),
      join(root, "velloo"),
      run(),
    );
    expect(bad).toEqual({ problem: "Use an http(s) URL." });
  });
});

describe("where the components are is found, never asked", () => {
  test("in a monorepo it is under the app, and so is everything read from the app", async () => {
    await directory({
      "package.json": JSON.stringify({ name: "repo", workspaces: ["apps/*"] }),
      "apps/web/package.json": pkg({ "@mui/material": "^6.0.0" }),
      "apps/web/components/ui/button.tsx": PAGE,
    });
    expect(await answers("blank")).toMatchObject({
      library: "mui",
      scanRoot: join(root, "apps", "web"),
      componentsRelative: "apps/web/components/ui",
    });
  });

  test("a second design in the repo keeps the first one's answer", async () => {
    await directory({ "package.json": pkg({}), "components/ui/button.tsx": PAGE });
    const built = await answers("blank", {}, { inheritComponentsDir: "src/ui" });
    expect(built.componentsRelative).toBe("src/ui");
  });
});

describe("where the design goes", () => {
  const check = (body: Partial<Parameters<typeof placeFor>[0]>, more: Partial<InitRun> = {}) =>
    placeFor({ appRoot: root, storage: "repository", ...body }, run(more));

  test("in the repository it is ./velloo, or ./velloo-brand beside a design already here", async () => {
    expect((await check({})).place.folder).toBe(join(root, "velloo"));
    expect((await check({}, { secondFolder: true })).place.folder).toBe(join(root, "velloo-brand"));
  });

  test("outside it, the managed folder this run picked", async () => {
    const { place } = await check({ storage: "external" });
    expect(place).toEqual({ folder: run().managedFolder, managedId: "m1" });
  });

  test("a folder that isn't empty, or is a design already, is refused before anything is written", async () => {
    await write("taken/file.txt", "x");
    expect((await check({ storage: "custom", folder: "taken" })).problem).toContain("isn't empty");
    expect((await check({ storage: "custom", folder: "" })).problem).toBe(
      "Enter a folder for the design.",
    );
  });

  test("the command line's choice wins over the page's", async () => {
    const fixed = { storage: "custom" as const, folder: join(root, "chosen") };
    expect((await check({ storage: "external" }, { fixed })).place.folder).toBe(fixed.folder);
  });
});
