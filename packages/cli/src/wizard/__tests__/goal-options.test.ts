import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findComponentsDir } from "../../scan/detect.ts";
import { discoverScanRoots } from "../../scan/index.ts";
import { hostGoalOptions } from "../prompts.ts";
import { interactiveLibraryChoices } from "../provider-registry.ts";

describe("start-menu goals", () => {
  test("a repo with UI code offers the host-reading goals plus the self-contained ones", () => {
    const values = hostGoalOptions(true).map((o) => o.value);
    expect(values).toEqual(["redesign-screen", "redesign-component", "custom", "sample", "blank"]);
  });

  test("the brand / consistency check is gone until it's designed properly", () => {
    expect(hostGoalOptions(true).map((o) => o.value)).not.toContain("brand-check");
  });

  test("a repo with no UI code offers only the starts that need no host app", () => {
    expect(hostGoalOptions(false).map((o) => o.value)).toEqual(["sample", "blank"]);
  });

  test("quit is gone — Ctrl+C cancels instead", () => {
    for (const hasHost of [true, false]) {
      expect(hostGoalOptions(hasHost).map((o) => o.value)).not.toContain("quit");
    }
  });

  test("every option carries a hint describing it", () => {
    for (const option of hostGoalOptions(true)) {
      expect(option.hint.length).toBeGreaterThan(0);
    }
  });

  test("an empty directory reports no host app, so the menu narrows", async () => {
    const dir = await mkdtemp(join(tmpdir(), "velloo-empty-"));
    expect(await discoverScanRoots(dir)).toEqual([]);
    expect(hostGoalOptions((await discoverScanRoots(dir)).length > 0).map((o) => o.value)).toEqual([
      "sample",
      "blank",
    ]);
  });

  test("the library list leads with shadcn and ends with no-library", () => {
    const values = interactiveLibraryChoices().map((c) => c.value);
    expect(values[0]).toBe("shadcn-upstream");
    expect(values.at(-1)).toBe("none");
  });

  test("no library hint promises to write components into the user's app", () => {
    for (const choice of interactiveLibraryChoices()) {
      expect(choice.hint).not.toMatch(/added to your app/i);
    }
  });

  test("a directory holding a React app reports a host app", async () => {
    const dir = await mkdtemp(join(tmpdir(), "velloo-app-"));
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "app", dependencies: { react: "^18.0.0" } }),
    );
    expect((await discoverScanRoots(dir)).length).toBeGreaterThan(0);
  });
});

describe("components directory detection", () => {
  test("an empty app root has none, so there's nothing to ask about", async () => {
    const dir = await mkdtemp(join(tmpdir(), "velloo-nocomp-"));
    expect(findComponentsDir(dir)).toBeUndefined();
  });

  test("a conventional layout answers the question without asking", async () => {
    const dir = await mkdtemp(join(tmpdir(), "velloo-comp-"));
    await mkdir(join(dir, "src/components/ui"), { recursive: true });
    expect(findComponentsDir(dir)).toBe("src/components/ui");
  });

  test("a rootless layout is found too", async () => {
    const dir = await mkdtemp(join(tmpdir(), "velloo-comp2-"));
    await mkdir(join(dir, "components/ui"), { recursive: true });
    expect(findComponentsDir(dir)).toBe("components/ui");
  });
});
