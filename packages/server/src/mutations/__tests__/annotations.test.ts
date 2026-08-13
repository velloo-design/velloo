import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@velloo/schema";
import { type DesignFolder, loadDesignFolder } from "../../design-folder.ts";
import {
  addAnnotation,
  addNote,
  type MutationContext,
  removeAnnotation,
  removeNote,
  updateAnnotation,
  updateNote,
} from "../index.ts";

const sampleConfig = {
  schemaVersion: 1,
  toolVersion: "0.1.0",
  componentSource: { framework: "shadcn-react", snapshotVersion: "test" },
  viewportPresets: [{ name: "Mobile", w: 390, h: 844 }],
};

const sampleTheme = {
  name: "default",
  colors: {
    background: "oklch(1 0 0)",
    foreground: "oklch(0 0 0)",
    primary: { DEFAULT: "oklch(0.205 0 0)", foreground: "oklch(0.985 0 0)" },
  },
  typography: {},
  spacing: {},
  radius: {},
};

const samplePage: Page = {
  name: "P",
  variants: [
    {
      id: "mobile",
      name: "Mobile",
      viewport: { w: 390, h: 844 },
      tree: {
        $ref: "Card",
        children: [
          { $ref: "Heading", $id: "title", props: { level: 1, children: "x" } },
          { $ref: "Button", $id: "cta", props: { children: "y" } },
        ],
      },
    },
  ],
};

let tmp: string;
let folder: DesignFolder;
let ctx: MutationContext;

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-ann-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(tmp, ".design"), { recursive: true });
  await mkdir(join(tmp, "theme"), { recursive: true });
  await mkdir(join(tmp, "pages"), { recursive: true });
  await writeFile(join(tmp, ".design/config.json"), JSON.stringify(sampleConfig), "utf8");
  await writeFile(join(tmp, "theme/default.json"), JSON.stringify(sampleTheme), "utf8");
  await writeFile(join(tmp, "pages/p.json"), JSON.stringify(samplePage), "utf8");
  folder = await loadDesignFolder(tmp);
  ctx = { folder, broadcast: () => {} };
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("annotations", () => {
  test("addAnnotation writes the sidecar + resolves locator + auto position default", async () => {
    const r = await addAnnotation(ctx, {
      pageId: "p",
      target: { variantId: "mobile", locator: "@cta" },
      body: "**Tighten the copy here.**",
    });
    if (!r.ok) throw new Error(`expected ok: ${JSON.stringify(r.error)}`);
    expect(r.value.annotation.body).toContain("Tighten");
    expect(r.value.annotation.position).toBe("auto");
    const onDisk = JSON.parse(
      await readFile(join(tmp, "pages/p.annotations.json"), "utf8"),
    ) as unknown[];
    expect(onDisk).toHaveLength(1);
    expect(folder.annotations.get("p")).toHaveLength(1);
  });

  test("addAnnotation refuses to attach when the locator doesn't resolve", async () => {
    const r = await addAnnotation(ctx, {
      pageId: "p",
      target: { variantId: "mobile", locator: "@nope" },
      body: "x",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("IdNotFound");
  });

  test("addAnnotation refuses two annotations on the same node (AnnotationConflict)", async () => {
    await addAnnotation(ctx, {
      pageId: "p",
      target: { variantId: "mobile", locator: "@cta" },
      body: "first",
    });
    // Same node via different locator forms — should still conflict.
    const r = await addAnnotation(ctx, {
      pageId: "p",
      target: { variantId: "mobile", locator: [1] }, // resolves to the cta node
      body: "second",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("AnnotationConflict");
      if (r.error.kind === "AnnotationConflict") {
        expect(r.error.existingId).toMatch(/^ann_/);
      }
    }
  });

  test("updateAnnotation patches body + position", async () => {
    const add = await addAnnotation(ctx, {
      pageId: "p",
      target: { variantId: "mobile", locator: "@cta" },
      body: "v1",
    });
    if (!add.ok) throw new Error("expected ok");
    const id = add.value.annotation.id;
    const upd = await updateAnnotation(ctx, {
      pageId: "p",
      annotationId: id,
      patch: { body: "v2", position: { x: -120, y: 40 } },
    });
    if (!upd.ok) throw new Error("expected ok");
    expect(upd.value.annotation.body).toBe("v2");
    expect(upd.value.annotation.position).toEqual({ x: -120, y: 40 });
  });

  test("removeAnnotation drops the entry; emptying removes the sidecar", async () => {
    const add = await addAnnotation(ctx, {
      pageId: "p",
      target: { variantId: "mobile", locator: "@cta" },
      body: "x",
    });
    if (!add.ok) throw new Error("expected ok");
    const r = await removeAnnotation(ctx, { pageId: "p", annotationId: add.value.annotation.id });
    if (!r.ok) throw new Error("expected ok");
    expect(folder.annotations.get("p")).toHaveLength(0);
    await expect(readFile(join(tmp, "pages/p.annotations.json"), "utf8")).rejects.toThrow();
  });

  test("AnnotationNotFound when removing an unknown id", async () => {
    const r = await removeAnnotation(ctx, { pageId: "p", annotationId: "ann_missing" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("AnnotationNotFound");
  });
});

describe("canvas notes", () => {
  test("addNote writes the sidecar with default width", async () => {
    const r = await addNote(ctx, { pageId: "p", x: 100, y: 200, body: "# hi" });
    if (!r.ok) throw new Error("expected ok");
    expect(r.value.note.width).toBe(240);
    const onDisk = JSON.parse(await readFile(join(tmp, "pages/p.notes.json"), "utf8")) as unknown[];
    expect(onDisk).toHaveLength(1);
  });

  test("updateNote patches position + body + width", async () => {
    const add = await addNote(ctx, { pageId: "p", x: 0, y: 0, body: "x" });
    if (!add.ok) throw new Error("expected ok");
    const upd = await updateNote(ctx, {
      pageId: "p",
      noteId: add.value.note.id,
      patch: { x: 50, y: 60, width: 320, body: "y" },
    });
    if (!upd.ok) throw new Error("expected ok");
    expect(upd.value.note).toMatchObject({ x: 50, y: 60, width: 320, body: "y" });
  });

  test("removeNote drops the entry; CanvasNoteNotFound on unknown", async () => {
    const add = await addNote(ctx, { pageId: "p", x: 0, y: 0, body: "x" });
    if (!add.ok) throw new Error("expected ok");
    const r = await removeNote(ctx, { pageId: "p", noteId: add.value.note.id });
    if (!r.ok) throw new Error("expected ok");
    expect(folder.notes.get("p")).toHaveLength(0);
    const r2 = await removeNote(ctx, { pageId: "p", noteId: "note_nope" });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error.kind).toBe("CanvasNoteNotFound");
  });
});

describe("page removal cascades sidecars", () => {
  test("removing a page nukes its annotations + notes from memory", async () => {
    await addAnnotation(ctx, {
      pageId: "p",
      target: { variantId: "mobile", locator: "@cta" },
      body: "x",
    });
    await addNote(ctx, { pageId: "p", x: 0, y: 0, body: "y" });
    expect(folder.annotations.get("p")?.length).toBe(1);
    expect(folder.notes.get("p")?.length).toBe(1);
    const { reloadPage } = await import("../../design-folder.ts");
    await rm(join(tmp, "pages/p.json"));
    await reloadPage(folder, "p");
    expect(folder.annotations.has("p")).toBe(false);
    expect(folder.notes.has("p")).toBe(false);
  });
});
