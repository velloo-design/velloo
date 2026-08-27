import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CURRENT_SCHEMA_VERSION } from "@velloo/schema";
import { upgradeFolder } from "../upgrade-folder.ts";

/** Scaffold a minimal legacy (schema v1) design folder. */
async function legacyFolder(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "velloo-upgrade-"));
  await mkdir(join(root, ".design"), { recursive: true });
  await mkdir(join(root, "screens"), { recursive: true });
  await mkdir(join(root, "boards"), { recursive: true });
  await mkdir(join(root, "theme"), { recursive: true });
  await writeFile(
    join(root, ".design", "config.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        toolVersion: "0.0.1 (legacy)",
        library: {
          id: "shadcn-react",
          version: "2026.05.22",
          source: "embedded:shadcn",
          componentsPath: "binary",
        },
        viewportPresets: [{ name: "Desktop", w: 1440, h: 900 }],
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(root, "theme", "default.json"),
    JSON.stringify({
      name: "Test",
      colors: { background: "#fff", foreground: "#111", primary: "#06f" },
      typography: {},
      spacing: {},
      radius: {},
    }),
  );
  await writeFile(
    join(root, "screens", "home.json"),
    JSON.stringify({ id: "home", name: "Home", tree: { $ref: "Box" } }),
  );
  await writeFile(
    join(root, "screens", "home.annotations.json"),
    JSON.stringify([{ id: "a1", target: { locator: [0] }, position: "auto", body: "check this" }]),
  );
  return root;
}

describe("upgradeFolder", () => {
  test("migrates a legacy folder to the current version on disk", async () => {
    const root = await legacyFolder();
    const result = await upgradeFolder(root);
    expect(result.from).toBe(1);
    expect(result.to).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.applied.length).toBeGreaterThan(0);

    const config = JSON.parse(await readFile(join(root, ".design", "config.json"), "utf8"));
    expect(config.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(config.library).toBeUndefined();
    expect(config.defaultLibrary).toBe("default");
    expect(config.libraries.default.id).toBe("shadcn-upstream");
    expect(config.libraries.default.source).toBe("binary");
    // Upgrade refreshes the recorded tool version.
    expect(config.toolVersion).not.toBe("0.0.1 (legacy)");

    const annotations = JSON.parse(
      await readFile(join(root, "screens", "home.annotations.json"), "utf8"),
    );
    expect(annotations[0].author).toBe("user");
  });

  test("is idempotent", async () => {
    const root = await legacyFolder();
    await upgradeFolder(root);
    const configAfterFirst = await readFile(join(root, ".design", "config.json"), "utf8");
    const second = await upgradeFolder(root);
    expect(second.applied).toEqual([]);
    expect(second.changedFiles).toEqual([]);
    expect(await readFile(join(root, ".design", "config.json"), "utf8")).toBe(configAfterFirst);
  });

  test("dry run reports without writing", async () => {
    const root = await legacyFolder();
    const before = await readFile(join(root, ".design", "config.json"), "utf8");
    const result = await upgradeFolder(root, { dryRun: true });
    expect(result.applied.length).toBeGreaterThan(0);
    expect(result.changedFiles).toContain(join(".design", "config.json"));
    expect(result.changedFiles).toContain(join("screens", "home.annotations.json"));
    expect(await readFile(join(root, ".design", "config.json"), "utf8")).toBe(before);
  });

  test("rejects a folder from a newer velloo", async () => {
    const root = await legacyFolder();
    const configPath = join(root, ".design", "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.schemaVersion = CURRENT_SCHEMA_VERSION + 1;
    await writeFile(configPath, JSON.stringify(config));
    expect(upgradeFolder(root)).rejects.toThrow(/newer than this velloo/);
  });
});
