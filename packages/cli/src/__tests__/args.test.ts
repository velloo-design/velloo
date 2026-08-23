import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
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
  test("defaults: cwd app root, velloo design folder, shadcn-react binary, sample", () => {
    const a = answersFromArgs({});
    expect(a.library).toBe("shadcn-react");
    expect(a.source).toBe("binary");
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

  test("--start=scan sets scan content; non-upstream stays binary", () => {
    const a = answersFromArgs({ start: "scan" });
    expect(a.initialContent).toBe("scan");
    expect(a.source).toBe("binary");
  });

  test("blank theme preset is treated as unset", () => {
    const a = answersFromArgs({ themePreset: "   " });
    expect(a.themePreset).toBeUndefined();
  });

  test("--surface picks a Pulse slice; only valid for the shadcn sample", () => {
    expect(answersFromArgs({ surface: "analytics" }).productSurface).toBe("analytics");
    expect(answersFromArgs({}).productSurface).toBeUndefined();
    expect(() => answersFromArgs({ surface: "ecommerce" })).toThrow(/unknown --surface/);
    expect(() => answersFromArgs({ surface: "saas", library: "none" })).toThrow(
      /--surface only applies/,
    );
    expect(() => answersFromArgs({ surface: "saas", initialContent: "blank" })).toThrow(
      /--surface only applies/,
    );
  });

  test("--vibe themes by feel and excludes --theme-preset", () => {
    expect(answersFromArgs({ vibe: "playful" }).themeVibe).toBe("playful");
    expect(() => answersFromArgs({ vibe: "corporate-synergy" })).toThrow(/unknown --vibe/);
    expect(() => answersFromArgs({ vibe: "playful", themePreset: "violet" })).toThrow(/not both/);
  });

  test("--stack records the app stack for the codegen alias", () => {
    expect(answersFromArgs({ stack: "remix" }).stack).toBe("remix");
    expect(answersFromArgs({}).stack).toBeUndefined();
    expect(() => answersFromArgs({ stack: "rails" })).toThrow(/unknown --stack/);
  });
});
