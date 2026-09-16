import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findDesigns } from "../designs.ts";
import { listLocalDesigns, localDesignsAt, writeLocalDesign } from "../project-location.ts";

let root: string;
let storage: string;
let previousHome: string | undefined;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "velloo-location-")));
  storage = join(root, "designs");
  previousHome = process.env.VELLOO_DESIGNS_HOME;
  process.env.VELLOO_DESIGNS_HOME = storage;
});

afterEach(async () => {
  if (previousHome === undefined) delete process.env.VELLOO_DESIGNS_HOME;
  else process.env.VELLOO_DESIGNS_HOME = previousHome;
  await rm(root, { recursive: true, force: true });
});

async function localDesign(id: string, project: string, name: string): Promise<void> {
  const folder = join(storage, id);
  await mkdir(join(folder, ".design"), { recursive: true });
  await writeFile(join(folder, ".design", "config.json"), JSON.stringify({ name }));
  await mkdir(project, { recursive: true });
  await writeLocalDesign(id, { root: project, appRoot: project });
}

describe("local designs belong to one project directory", () => {
  test("a design recorded for a parent directory is invisible from a folder inside it", async () => {
    const parent = join(root, "code");
    const child = join(parent, "someapp");
    await localDesign("aaaaaaaa-parent", parent, "parent");
    await mkdir(child, { recursive: true });

    expect(localDesignsAt(parent).map((d) => d.id)).toEqual(["aaaaaaaa-parent"]);
    expect(localDesignsAt(child)).toEqual([]);
    expect(await findDesigns(child)).toBeNull();
  });
});

describe("development-build location records", () => {
  test("are read with their manifest's directory as the project, and rewritten", async () => {
    const project = join(root, "mono");
    const app = join(project, "apps", "web");
    await mkdir(app, { recursive: true });
    await mkdir(join(storage, ".locations"), { recursive: true });
    const recordPath = join(storage, ".locations", "bbbbbbbb-legacy.json");
    await writeFile(
      recordPath,
      JSON.stringify({
        manifestPath: join(project, "velloo.json"),
        appRoot: app,
        projectName: "webapp",
      }),
    );

    const [design] = listLocalDesigns();
    expect(design).toMatchObject({
      id: "bbbbbbbb-legacy",
      root: project,
      appRoot: app,
      legacyName: "webapp",
    });
    expect(localDesignsAt(project).map((d) => d.id)).toEqual(["bbbbbbbb-legacy"]);

    let rewritten: unknown;
    for (let i = 0; i < 50 && !rewritten; i++) {
      const raw = JSON.parse(await readFile(recordPath, "utf8")) as Record<string, unknown>;
      if ("root" in raw) rewritten = raw;
      else await Bun.sleep(10);
    }
    expect(rewritten).toEqual({ root: project, appRoot: app, projectName: "webapp" });
  });
});
