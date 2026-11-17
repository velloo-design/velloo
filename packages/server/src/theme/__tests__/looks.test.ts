import { beforeEach, expect, test } from "bun:test";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadDesignFolder } from "../../design-folder.ts";
import {
  deleteSketchbook,
  removeSketchbookImage,
  updateSketchbook,
} from "../../sketchbook/sketchbook.ts";
import { type TestContext, testContext } from "../../testing/design-folder.ts";
import { removeTheme, renameTheme } from "../index.ts";
import { listLooks, lookFromSketchbook, updateLook } from "../looks.ts";

let t: TestContext;
const SB = "sb1";
const img = (name: string) => `assets/sketchbook/${SB}/poster/${name}`;

async function put(path: string, body = "x") {
  await mkdir(dirname(join(t.root, path)), { recursive: true });
  await writeFile(join(t.root, path), body);
}

const exists = (path: string) =>
  stat(join(t.root, path)).then(
    () => true,
    () => false,
  );

const image = (path: string) => ({
  path,
  model: "velloo-sketch",
  prompt: "p",
  createdAt: "2026-11-13T00:00:00.000Z",
});

beforeEach(async () => {
  t = await testContext();
  await put(
    `sketchbooks/${SB}.json`,
    JSON.stringify({
      version: 1,
      stage: "mocks",
      brief: { origin: "new", product: "Trailhead", page: "the landing page" },
      chosen: [],
      directions: [
        {
          id: "poster",
          title: "Park poster",
          description: "Screen-printed park posters. Ochre, pine and cream.",
          images: [
            { kind: "moodboard", ...image(img("board-1.png")) },
            { kind: "moodboard", ...image(img("board-2.png")) },
            { kind: "mock", ...image(img("mock-1.png")) },
          ],
        },
        { id: "bare", title: "Bare", description: "No images yet" },
      ],
    }),
  );
  for (const name of ["board-1.png", "board-2.png", "mock-1.png"]) await put(img(name));
});

const make = () => lookFromSketchbook(t.ctx, { sketchbook: SB, direction: "poster" });

test("a direction becomes a Look: a theme named after it, its current mood board and mocks, its origin", async () => {
  const r = await make();
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  expect(r.value).toMatchObject({ name: "Park poster", created: true });
  expect(r.value.look.images).toEqual([
    {
      path: img("board-2.png"),
      kind: "moodboard",
      source: { sketchbook: SB, direction: "poster" },
    },
    { path: img("mock-1.png"), kind: "mock", source: { sketchbook: SB, direction: "poster" } },
  ]);
  expect(r.value.look.origin).toEqual({ sketchbook: SB, direction: "poster" });
  expect(r.value.look.description).toBe("Screen-printed park posters.");
  expect(t.folder.themes.has("Park poster")).toBe(true);
  const onDisk = JSON.parse(await readFile(join(t.root, "looks/Park poster.json"), "utf8"));
  expect(onDisk.images).toHaveLength(2);
  expect(t.events.some((e) => e.type === "theme-changed")).toBe(true);

  const again = await make();
  expect(again.ok && again.value.name).toBe("Park poster 2");
});

test("a direction with no images can't become a Look", async () => {
  const r = await lookFromSketchbook(t.ctx, { sketchbook: SB, direction: "bare" });
  expect(r.ok).toBe(false);
  expect(t.folder.themes.size).toBe(1);
});

test("a Look's rules, imagery and images are patched; its paths must be this design's assets", async () => {
  await make();
  const r = await updateLook(t.ctx, "Park poster", {
    rules: { dos: ["Ink-heavy illustration"] },
    imagery: "Two-colour screen prints",
    removeImages: [img("mock-1.png")],
  });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  expect(r.value.rules).toEqual({ dos: ["Ink-heavy illustration"], donts: [] });
  expect(r.value.imagery).toBe("Two-colour screen prints");
  expect(r.value.images.map((i) => i.path)).toEqual([img("board-2.png")]);

  expect(
    (await updateLook(t.ctx, "Park poster", { images: [{ path: "../x.png", kind: "image" }] })).ok,
  ).toBe(false);
  expect((await updateLook(t.ctx, "Nope", { imagery: "x" })).ok).toBe(false);
  // A plain Look gets a sidecar on its first write.
  expect((await updateLook(t.ctx, "default", { description: "The house look" })).ok).toBe(true);
  expect(listLooks(t.ctx).map((l) => [l.name, l.look?.description])).toEqual([
    ["default", "The house look"],
    ["Park poster", "Screen-printed park posters."],
  ]);
});

test("renaming a theme moves its Look, and removing it removes the Look", async () => {
  await make();
  const renamed = await renameTheme(t.ctx, "Park poster", "Poster");
  expect(renamed.ok).toBe(true);
  expect(await exists("looks/Park poster.json")).toBe(false);
  expect(await exists("looks/Poster.json")).toBe(true);
  expect(t.folder.looks.get("Poster")?.origin?.direction).toBe("poster");
  // A change of case alone is one file on a case-insensitive disk.
  expect((await renameTheme(t.ctx, "Poster", "poster")).ok).toBe(true);
  expect(t.folder.looks.has("poster")).toBe(true);
  expect((await removeTheme(t.ctx, "poster")).ok).toBe(true);
  expect(await exists("looks/poster.json")).toBe(false);
  expect(t.folder.looks.size).toBe(0);
});

test("the design folder loads its Looks, and leaves out one that doesn't parse", async () => {
  await make();
  await put("looks/Broken.json", "{ nope");
  const folder = await loadDesignFolder(t.root);
  expect([...folder.looks.keys()]).toEqual(["Park poster"]);
});

test("a Look keeps its images when the sketchbook lets them go", async () => {
  await make();
  await removeSketchbookImage(t.ctx, SB, img("mock-1.png"));
  await Bun.sleep(20);
  expect(await exists(img("mock-1.png"))).toBe(true);

  await updateSketchbook(t.ctx, SB, { removeDirections: ["poster"] });
  expect(await exists(img("board-2.png"))).toBe(true);
  // The older mood board no Look shows goes with the direction.
  expect(await exists(img("board-1.png"))).toBe(false);

  await deleteSketchbook(t.ctx, SB);
  expect(await exists(img("board-2.png"))).toBe(true);
  expect(await exists(img("mock-1.png"))).toBe(true);
});

test("the sweep deletes nothing while a Look's file can't be read", async () => {
  await put("looks/Broken.json", "{ nope");
  await deleteSketchbook(t.ctx, SB);
  expect(await exists(img("board-1.png"))).toBe(true);
});

test("a direction with proposed tokens becomes a Look with them", async () => {
  const r = await updateSketchbook(t.ctx, SB, {
    directions: [
      {
        id: "poster",
        proposal: {
          tokens: { "colors.primary.DEFAULT": "#2f4a3a" },
          fonts: [{ role: "display", family: "Fraunces", google: true }],
        },
      },
    ],
  });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  const made = await make();
  if (!made.ok) throw new Error(JSON.stringify(made.error));
  const theme = t.ctx.folder.themes.get(made.value.name);
  expect(theme?.colors.primary).toMatchObject({ DEFAULT: "#2f4a3a" });
  expect(theme?.typography.fontFamily?.display).toContain("Fraunces");
  // The theme it was copied from is untouched.
  expect(JSON.stringify(t.ctx.folder.theme)).not.toContain("Fraunces");
});

test("a Look made from a direction carries its references, and update_look adds more", async () => {
  await put(`assets/sketchbook/${SB}/refs/linear.png`);
  const raw = JSON.parse(await readFile(join(t.root, `sketchbooks/${SB}.json`), "utf8"));
  raw.references = [
    {
      id: "linear",
      path: `assets/sketchbook/${SB}/refs/linear.png`,
      url: "https://linear.app/",
      note: "the dark palette",
      createdAt: "2026-11-13T00:00:00.000Z",
    },
  ];
  raw.directions[0].references = ["linear"];
  await writeFile(join(t.root, `sketchbooks/${SB}.json`), JSON.stringify(raw));
  const r = await make();
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  expect(r.value.look.references).toEqual([
    {
      path: `assets/sketchbook/${SB}/refs/linear.png`,
      url: "https://linear.app/",
      note: "the dark palette",
    },
  ]);
  await put("assets/shot.png");
  const more = await updateLook(t.ctx, r.value.name, {
    references: [{ path: "assets/shot.png", note: "its spacing" }],
    removeReferences: [`assets/sketchbook/${SB}/refs/linear.png`],
  });
  if (!more.ok) throw new Error(JSON.stringify(more.error));
  expect(more.value.references).toEqual([{ path: "assets/shot.png", note: "its spacing" }]);
  const missing = await updateLook(t.ctx, r.value.name, {
    references: [{ path: "assets/nope.png" }],
  });
  expect(missing.ok).toBe(false);
});
