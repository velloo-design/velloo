import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CURRENT_SCHEMA_VERSION } from "@velloo/schema";
import { isDesignFolderSync, isEmptyOrMissingSync } from "../design.ts";
import { factsLine, inheritedFromFolder, readFolderFacts } from "../existing-folder.ts";
import { TOOL_VERSION } from "../version.ts";

let repo: string;
let folder: string;

async function writeConfig(patch: Record<string, unknown> = {}) {
  await writeFile(
    join(folder, ".design", "config.json"),
    JSON.stringify({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      toolVersion: TOOL_VERSION,
      name: "app",
      libraries: {
        default: {
          id: "shadcn-upstream",
          version: "x",
          source: "binary",
          componentsPath: "binary",
        },
      },
      defaultLibrary: "default",
      viewportPresets: [{ name: "Desktop", w: 1440, h: 900 }],
      ...patch,
    }),
    "utf8",
  );
}

beforeEach(async () => {
  repo = join(tmpdir(), `velloo-existing-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  folder = join(repo, "velloo");
  await mkdir(join(folder, ".design"), { recursive: true });
  await writeConfig();
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe("readFolderFacts", () => {
  test("reports the library, format version, and a clean migration plan", async () => {
    const facts = await readFolderFacts(folder, repo);
    expect(facts.library).toBe("shadcn-upstream");
    expect(facts.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(facts.pendingMigrations).toEqual([]);
    expect(facts.toolVersionStale).toBe(false);
    expect(facts.design).toBeUndefined();
  });

  test("an older folder reports the migrations `velloo upgrade` would apply", async () => {
    await writeConfig({ schemaVersion: 1 });
    const facts = await readFolderFacts(folder, repo);
    expect(facts.schemaVersion).toBe(1);
    expect(facts.pendingMigrations.length).toBeGreaterThan(0);
  });

  test("a folder written by another velloo reads as stale", async () => {
    await writeConfig({ toolVersion: "0.0.1-ancient" });
    expect((await readFolderFacts(folder, repo)).toolVersionStale).toBe(true);
  });

  test("picks up the design name from its config", async () => {
    await writeFile(join(repo, "velloo.json"), JSON.stringify({ designs: ["velloo"] }), "utf8");
    expect((await readFolderFacts(folder, repo)).design).toBe("app");
  });

  test("a broken manifest doesn't break the menu — it just reports no design", async () => {
    await writeFile(join(repo, "velloo.json"), "{ not json", "utf8");
    expect((await readFolderFacts(folder, repo)).design).toBeUndefined();
  });

  test("factsLine summarizes the folder in one line", async () => {
    await writeFile(join(repo, "velloo.json"), JSON.stringify({ designs: ["velloo"] }), "utf8");
    const line = factsLine(await readFolderFacts(folder, repo), folder);
    expect(line).toContain("shadcn-upstream");
    expect(line).toContain(`format v${CURRENT_SCHEMA_VERSION} (current)`);
    expect(line).toContain('design "app"');
  });
});

describe("inheritedFromFolder", () => {
  test("a second folder inherits the first's library and components dir", async () => {
    await writeConfig({
      libraries: {
        default: { id: "mui", version: "6", source: "binary", componentsPath: "binary" },
      },
      codegen: { componentsAlias: "@/components/ui", componentsDir: "app/ui/components" },
    });
    expect(await inheritedFromFolder(folder)).toEqual({
      library: "mui",
      componentsDir: "app/ui/components",
    });
  });

  test("a folder written before componentsDir was recorded inherits just the library", async () => {
    expect(await inheritedFromFolder(folder)).toEqual({
      library: "shadcn-upstream",
      componentsDir: undefined,
    });
  });

  test("an unreadable folder inherits nothing rather than throwing", async () => {
    expect(await inheritedFromFolder(join(repo, "nope"))).toEqual({
      library: undefined,
      componentsDir: undefined,
    });
  });
});

describe("folder-prompt validators", () => {
  // These back the wizard's "Where should the design folder live?" prompt, so
  // an occupied path is rejected as it's typed rather than after the wizard.
  test("an existing design folder is recognized", () => {
    expect(isDesignFolderSync(folder)).toBe(true);
    expect(isDesignFolderSync(join(repo, "velloo-brand"))).toBe(false);
  });

  test("missing counts as empty; occupied does not", async () => {
    expect(isEmptyOrMissingSync(join(repo, "velloo-brand"))).toBe(true);
    await mkdir(join(repo, "velloo-brand"), { recursive: true });
    expect(isEmptyOrMissingSync(join(repo, "velloo-brand"))).toBe(true);
    await writeFile(join(repo, "velloo-brand", "notes.md"), "x", "utf8");
    expect(isEmptyOrMissingSync(join(repo, "velloo-brand"))).toBe(false);
  });
});
