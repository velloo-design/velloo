import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveRunTargets } from "../run-targets.ts";
import { buildDefaultConfig } from "../scaffold/default-config.ts";

let tmp: string;

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-run-targets-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tmp, { recursive: true });
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function makeDesignFolder(path: string, name: string): Promise<void> {
  await mkdir(join(path, ".design"), { recursive: true });
  await writeFile(
    join(path, ".design", "config.json"),
    JSON.stringify(buildDefaultConfig({ name })),
  );
}

async function writeManifest(manifest: unknown): Promise<void> {
  await writeFile(join(tmp, "velloo.json"), JSON.stringify(manifest, null, 2), "utf8");
}

describe("resolveRunTargets", () => {
  test("a bare run in a multi-design repo starts every design", async () => {
    await makeDesignFolder(join(tmp, "velloo"), "app");
    await makeDesignFolder(join(tmp, "brand"), "brand");
    await writeManifest({ designs: ["velloo", "brand"] });
    const targets = await resolveRunTargets(undefined, { cwd: tmp });
    expect(targets.map((t) => t.name)).toEqual(["app", "brand"]);
  });

  test("the default design leads, so `o` and --open hit the expected canvas", async () => {
    await makeDesignFolder(join(tmp, "velloo"), "app");
    await makeDesignFolder(join(tmp, "brand"), "brand");
    await writeManifest({ designs: ["velloo", "brand"], defaultDesign: "brand" });
    expect((await resolveRunTargets(undefined, { cwd: tmp })).map((t) => t.name)).toEqual([
      "brand",
      "app",
    ]);
  });

  test("naming a design runs only that one", async () => {
    await makeDesignFolder(join(tmp, "velloo"), "app");
    await makeDesignFolder(join(tmp, "brand"), "brand");
    await writeManifest({ designs: ["velloo", "brand"] });
    const targets = await resolveRunTargets("brand", { cwd: tmp });
    expect(targets).toEqual([{ name: "brand", folder: join(tmp, "brand") }]);
  });

  test("passing a path runs only that folder", async () => {
    await makeDesignFolder(join(tmp, "velloo"), "app");
    await makeDesignFolder(join(tmp, "brand"), "brand");
    await writeManifest({ designs: ["velloo", "brand"] });
    const targets = await resolveRunTargets("./brand", { cwd: tmp });
    expect(targets.map((t) => t.folder)).toEqual([join(tmp, "brand")]);
  });

  test("standing inside a design folder runs that one", async () => {
    await makeDesignFolder(join(tmp, "velloo"), "app");
    await makeDesignFolder(join(tmp, "brand"), "brand");
    await writeManifest({ designs: ["velloo", "brand"] });
    const targets = await resolveRunTargets(undefined, { cwd: join(tmp, "brand", "screens") });
    expect(targets.map((t) => t.name)).toEqual(["brand"]);
  });

  test("a single-design manifest behaves exactly as before", async () => {
    await makeDesignFolder(join(tmp, "velloo"), "app");
    await writeManifest({ designs: ["velloo"] });
    expect((await resolveRunTargets(undefined, { cwd: tmp })).map((t) => t.name)).toEqual(["app"]);
  });

  test("a design whose folder has gone is skipped, not started", async () => {
    await makeDesignFolder(join(tmp, "velloo"), "app");
    await writeManifest({ designs: ["velloo", "gone"] });
    expect((await resolveRunTargets(undefined, { cwd: tmp })).map((t) => t.name)).toEqual(["app"]);
  });

  test("no manifest keeps the ./velloo convention", async () => {
    await makeDesignFolder(join(tmp, "velloo"), "app");
    const targets = await resolveRunTargets(undefined, { cwd: tmp });
    expect(targets.map((t) => t.folder)).toEqual([join(tmp, "velloo")]);
    expect(targets[0]?.name).toBe("app");
  });
});
