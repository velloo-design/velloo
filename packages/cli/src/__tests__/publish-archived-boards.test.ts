import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type DesignFolder, loadDesignFolder } from "@velloo/server";
import { designConfig, designTheme } from "@velloo/server/testing";

import { pickBoards } from "../folder.ts";
import { selectBoards } from "../publish/core.ts";

/**
 * Archived boards must not ride along in a publish the user didn't ask for —
 * but naming one explicitly still works, on both the folder-scanning CLI
 * picker (`pickBoards`) and the loaded-folder selector (`selectBoards`).
 */

const sampleConfig = designConfig();

const sampleTheme = designTheme();

let tmp: string;
let folder: DesignFolder;

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

beforeEach(async () => {
  tmp = join(
    tmpdir(),
    `velloo-publish-archived-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(join(tmp, ".design"), { recursive: true });
  await mkdir(join(tmp, "theme"), { recursive: true });
  await mkdir(join(tmp, "boards"), { recursive: true });
  await writeJson(join(tmp, ".design/config.json"), sampleConfig);
  await writeJson(join(tmp, "theme/default.json"), sampleTheme);
  await writeJson(join(tmp, "boards/alpha.json"), {
    id: "alpha",
    name: "Alpha",
    frames: [],
    groups: [],
  });
  await writeJson(join(tmp, "boards/parked.json"), {
    id: "parked",
    name: "Parked",
    archivedAt: "2026-08-25T10:00:00.000Z",
    frames: [],
    groups: [],
  });
  folder = await loadDesignFolder(tmp);
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("selectBoards", () => {
  test("a default publish ships live boards only", () => {
    expect(selectBoards(folder).map((b) => b.id)).toEqual(["alpha"]);
    expect(selectBoards(folder, []).map((b) => b.id)).toEqual(["alpha"]);
  });

  test("naming an archived board publishes it — an explicit ask wins", () => {
    expect(selectBoards(folder, ["parked"]).map((b) => b.id)).toEqual(["parked"]);
    expect(selectBoards(folder, ["alpha", "parked"]).map((b) => b.id)).toEqual(["alpha", "parked"]);
  });
});

describe("pickBoards", () => {
  test("the non-interactive default skips archived boards", async () => {
    const picked = await pickBoards(tmp, undefined, false, "publish");
    expect(picked?.map((b) => b.id)).toEqual(["alpha"]);
  });

  test("--boards naming an archived board still resolves it", async () => {
    const picked = await pickBoards(tmp, "parked", false, "publish");
    expect(picked?.map((b) => b.id)).toEqual(["parked"]);
  });

  test("a folder whose every board is archived publishes nothing by default", async () => {
    await writeJson(join(tmp, "boards/alpha.json"), {
      id: "alpha",
      name: "Alpha",
      archivedAt: "2026-08-25T10:00:00.000Z",
      frames: [],
      groups: [],
    });
    expect(await pickBoards(tmp, undefined, false, "publish")).toEqual([]);
  });
});
