import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CURRENT_SCHEMA_VERSION } from "@velloo/schema";
import { isDesignFolderSync, isEmptyOrMissingSync } from "../design.ts";
import { inheritedFromFolder } from "../existing-folder.ts";
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
  // These back the setup page's folder check, so an occupied path is refused
  // as it's typed rather than when the design is created.
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
