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

  test("a repo with no UI code offers capture plus the starts that need no host app", () => {
    expect(hostGoalOptions(false).map((o) => o.value)).toEqual(["capture-site", "sample", "blank"]);
  });

  test("capture is offered ONLY when there's no UI to scan", () => {
    // With routes to read, a browser session is a heavier path to the same
    // place — it earns its slot only when a live site is the only input left.
    expect(hostGoalOptions(true).map((o) => o.value)).not.toContain("capture-site");
    expect(hostGoalOptions(false).map((o) => o.value)).toContain("capture-site");
  });

  test("capture leads the no-host menu, since it's the only start that reads something real", () => {
    expect(hostGoalOptions(false)[0]?.value).toBe("capture-site");
  });

  test("quit is gone — Ctrl+C cancels instead", () => {
    for (const hasHost of [true, false]) {
      expect(hostGoalOptions(hasHost).map((o) => o.value)).not.toContain("quit");
    }
  });

  test("every option carries a hint describing it", () => {
    for (const hasHost of [true, false]) {
      for (const option of hostGoalOptions(hasHost)) {
        expect(option.hint.length).toBeGreaterThan(0);
      }
    }
  });

  test("an empty directory reports no host app, so the menu narrows", async () => {
    const dir = await mkdtemp(join(tmpdir(), "velloo-empty-"));
    expect(await discoverScanRoots(dir)).toEqual([]);
    expect(hostGoalOptions((await discoverScanRoots(dir)).length > 0).map((o) => o.value)).toEqual([
      "capture-site",
      "sample",
      "blank",
    ]);
  });

  test("the library list includes every supported provider in display order", () => {
    expect(interactiveLibraryChoices()).toEqual([
      {
        value: "shadcn-upstream",
        label: "shadcn",
        hint: "Real shadcn, Tailwind classes. Recommended.",
      },
      {
        value: "antd",
        label: "Ant Design",
        hint: "Real antd v5, inline style objects.",
      },
      {
        value: "chakra",
        label: "Chakra UI",
        hint: "Real Chakra v2, sx styling.",
      },
      {
        value: "mui",
        label: "Material UI",
        hint: "Real @mui/material, sx styling.",
      },
      {
        value: "none",
        label: "No library",
        hint: "Plain Box / Stack / Text primitives.",
      },
    ]);
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
