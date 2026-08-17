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
  test("defaults: shadcn-react, binary source, sample content, velloo folder", () => {
    const a = answersFromArgs({});
    expect(a.library).toBe("shadcn-react");
    expect(a.source).toBe("binary");
    expect(a.initialContent).toBe("sample");
    expect(a.folder).toBe(resolve("velloo"));
    expect(a.componentsRelative).toBe("src/components/ui");
    expect(a.appPath).toBeUndefined();
    expect(a.themeColor).toBeUndefined();
    expect(a.themeVibe).toBeUndefined();
  });

  test("unknown flag values fail loudly instead of silently scaffolding defaults", () => {
    expect(() => answersFromArgs({ library: "bootstrap" })).toThrow(/unknown --library/);
    expect(() => answersFromArgs({ source: "ftp" })).toThrow(/unknown --source/);
    expect(() => answersFromArgs({ initialContent: "kitchen" })).toThrow(
      /unknown --initial-content/,
    );
  });

  test("valid flags pass through, paths resolved to absolute", () => {
    const a = answersFromArgs({
      folder: "my-designs",
      library: "shadcn-upstream",
      source: "in-repo",
      appPath: "../apps/web",
      componentsDir: "lib/ui",
      initialContent: "blank",
      themeColor: "#7C3AED",
      themeVibe: "calm",
    });
    expect(a.library).toBe("shadcn-upstream");
    expect(a.source).toBe("in-repo");
    expect(a.folder).toBe(resolve("my-designs"));
    expect(a.appPath).toBe(resolve("../apps/web"));
    expect(a.componentsRelative).toBe("lib/ui");
    expect(a.initialContent).toBe("blank");
    expect(a.themeColor).toBe("#7C3AED");
    expect(a.themeVibe).toBe("calm");
  });

  test("in-repo source without --app-path throws the guidance error", () => {
    expect(() => answersFromArgs({ source: "in-repo" })).toThrow(/--app-path/);
  });

  test("blank theme flags are treated as unset", () => {
    const a = answersFromArgs({ themeColor: "  ", themeVibe: "" });
    expect(a.themeColor).toBeUndefined();
    expect(a.themeVibe).toBeUndefined();
  });
});
