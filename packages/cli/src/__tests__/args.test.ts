import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { answersFromArgs, shouldRunWizard } from "../wizard/args.ts";

describe("shouldRunWizard", () => {
  test("runs only when stdin is a TTY and --non-interactive is absent", () => {
    expect(shouldRunWizard({}, true)).toBe(true);
    expect(shouldRunWizard({}, false)).toBe(false);
    expect(shouldRunWizard({ nonInteractive: true }, true)).toBe(false);
    expect(shouldRunWizard({ nonInteractive: true }, false)).toBe(false);
  });
});

describe("answersFromArgs", () => {
  test("defaults: cwd app root, velloo design folder, shadcn-upstream in-repo, sample", () => {
    const a = answersFromArgs({});
    expect(a.library).toBe("shadcn-upstream");
    expect(a.source).toBe("in-repo");
    expect(a.initialContent).toBe("sample");
    expect(a.appRoot).toBe(resolve("."));
    expect(a.folder).toBe(resolve(".", "velloo"));
    expect(a.componentsRelative).toBe("src/components/ui");
    expect(a.themePreset).toBeUndefined();
    expect(a.detected).toBeUndefined();
  });

  test("positional is the app root; design folder defaults under it", () => {
    const a = answersFromArgs({ folder: "../apps/web" });
    expect(a.appRoot).toBe(resolve("../apps/web"));
    expect(a.folder).toBe(resolve("../apps/web", "velloo"));
  });

  test("unknown flag values fail loudly instead of silently scaffolding defaults", () => {
    expect(() => answersFromArgs({ library: "bootstrap" })).toThrow(/unknown --library/);
    expect(() => answersFromArgs({ start: "fresh" })).toThrow(/unknown --start/);
    expect(() => answersFromArgs({ initialContent: "kitchen" })).toThrow(
      /unknown --initial-content/,
    );
    expect(() => answersFromArgs({ themePreset: "neon" })).toThrow(/unknown --theme-preset/);
  });

  test("upstream library derives in-repo source; subfolder + preset pass through", () => {
    const a = answersFromArgs({
      folder: ".",
      designFolder: "design",
      library: "shadcn-upstream",
      componentsDir: "lib/ui",
      initialContent: "blank",
      themePreset: "violet",
    });
    expect(a.library).toBe("shadcn-upstream");
    expect(a.source).toBe("in-repo");
    expect(a.folder).toBe(resolve(".", "design"));
    expect(a.componentsRelative).toBe("lib/ui");
    expect(a.initialContent).toBe("blank");
    expect(a.themePreset).toBe("violet");
  });

  test("--start=scan sets scan content; non-upstream libraries stay binary", () => {
    const a = answersFromArgs({ start: "scan" });
    expect(a.initialContent).toBe("scan");
    expect(a.source).toBe("in-repo");
    expect(answersFromArgs({ start: "scan", library: "none" }).source).toBe("binary");
  });

  test("--start=redesign-screen and --screen-name", () => {
    const a = answersFromArgs({ start: "redesign-screen", screenName: "Pricing" });
    expect(a.initialContent).toBe("redesign-screen");
    expect(a.screenName).toBe("Pricing");
  });

  test("--start=redesign-component requires --component", () => {
    expect(() => answersFromArgs({ start: "redesign-component" })).toThrow(
      /--component is required/,
    );
    const a = answersFromArgs({ start: "redesign-component", component: "sidebar" });
    expect(a.initialContent).toBe("component");
    expect(a.componentDescription).toBe("sidebar");
  });

  test("--start=custom requires --request", () => {
    expect(() => answersFromArgs({ start: "custom" })).toThrow(/--request is required/);
    const a = answersFromArgs({ start: "custom", request: "a pricing page" });
    expect(a.initialContent).toBe("custom");
    expect(a.customRequest).toBe("a pricing page");
  });

  test("blank theme preset is treated as unset", () => {
    const a = answersFromArgs({ themePreset: "   " });
    expect(a.themePreset).toBeUndefined();
  });

  test("--stack records the app stack for the codegen alias", () => {
    expect(answersFromArgs({ stack: "remix" }).stack).toBe("remix");
    expect(answersFromArgs({}).stack).toBeUndefined();
    expect(() => answersFromArgs({ stack: "rails" })).toThrow(/unknown --stack/);
  });
});

describe("componentsRelative detection", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = join(tmpdir(), `velloo-args-cd-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tmp, { recursive: true });
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  test("finds components/ui, the layout the old default missed", async () => {
    // A non-interactive init used to assume `src/components/ui` for every app.
    // For anything laid out as `components/ui` the library then pointed at a
    // directory that does not exist, and the app's own components — which the
    // MCP instructions tell agents to compose with — silently stopped resolving.
    await mkdir(join(tmp, "components", "ui"), { recursive: true });
    expect(answersFromArgs({ folder: tmp }).componentsRelative).toBe("components/ui");
  });

  test("prefers src/components/ui when both exist", async () => {
    await mkdir(join(tmp, "components", "ui"), { recursive: true });
    await mkdir(join(tmp, "src", "components", "ui"), { recursive: true });
    expect(answersFromArgs({ folder: tmp }).componentsRelative).toBe("src/components/ui");
  });

  test("an explicit --components-dir still wins", async () => {
    await mkdir(join(tmp, "components", "ui"), { recursive: true });
    expect(answersFromArgs({ folder: tmp, componentsDir: "app/ui" }).componentsRelative).toBe(
      "app/ui",
    );
  });

  test("falls back to the convention when the app has no component dir", () => {
    expect(answersFromArgs({ folder: tmp }).componentsRelative).toBe("src/components/ui");
  });
});
