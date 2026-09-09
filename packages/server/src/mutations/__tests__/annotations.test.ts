import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { unwrap } from "@velloo/result";
import type { Annotation, Screen } from "@velloo/schema";
import { testContext } from "../../testing/design-folder.ts";
import {
  addAnnotation,
  type MutationContext,
  removeAnnotation,
  updateAnnotation,
} from "../index.ts";

/**
 * Annotations are the user's own writing pinned to a node — the one thing in a
 * design folder an agent can't regenerate. The sidecar was at 23.8%, and its
 * failure modes are quiet ones: an anchor that silently duplicates, a patch
 * that drops a field it wasn't asked to touch, or a not-found that names the
 * wrong thing so the canvas shows the wrong recovery.
 */

let folder: Awaited<ReturnType<typeof testContext>>;
let ctx: MutationContext;

beforeEach(async () => {
  folder = await testContext({
    label: "annotations",
    screens: {
      home: {
        id: "home",
        name: "Home",
        tree: {
          $ref: "Card",
          children: [
            { $ref: "Box", $id: "hero", children: [{ $ref: "Text", props: { children: "hi" } }] },
            { $ref: "Box", $id: "footer" },
          ],
        },
      } as Screen,
      bare: true,
    },
  });
  ctx = folder.ctx;
});

afterEach(() => folder.cleanup());

const sidecar = (screenId = "home") =>
  Bun.file(join(folder.root, "screens", `${screenId}.annotations.json`));

const add = (locator: Annotation["target"]["locator"], body = "note", extra = {}) =>
  addAnnotation(ctx, { screenId: "home", target: { locator }, body, ...extra });

describe("add_annotation", () => {
  test("anchors a note, defaulting its placement and authorship", async () => {
    const { annotation } = unwrap(await add([0]));
    expect(annotation.id).toMatch(/^ann_[0-9a-f]{8}$/);
    expect(annotation.position).toBe("auto");
    expect(annotation.author).toBe("user");
    expect(annotation.body).toBe("note");
    expect(annotation).not.toHaveProperty("collapsed");
  });

  test("records an explicit position, collapse and author", async () => {
    const { annotation } = unwrap(
      await add([0], "pinned", { position: { x: 12, y: 34 }, collapsed: true, author: "agent" }),
    );
    expect(annotation.position).toEqual({ x: 12, y: 34 });
    expect(annotation.collapsed).toBe(true);
    expect(annotation.author).toBe("agent");
  });

  test("writes the sidecar and announces the change", async () => {
    unwrap(await add([0]));
    expect(await sidecar().exists()).toBe(true);
    expect((await sidecar().json()) as Annotation[]).toHaveLength(1);
    expect(folder.events.some((e) => "type" in e && e.type === "annotations-changed")).toBe(true);
  });

  test("several notes on different nodes coexist, in order", async () => {
    unwrap(await add([0], "first"));
    unwrap(await add([1], "second"));
    expect(ctx.folder.annotations.get("home")?.map((a) => a.body)).toEqual(["first", "second"]);
  });

  test("refuses a second note on a node that already has one", async () => {
    const { annotation } = unwrap(await add([0], "first"));
    const clash = await add([0], "second");
    expect(clash.ok).toBe(false);
    if (!clash.ok) {
      expect(clash.error.kind).toBe("AnnotationConflict");
      expect((clash.error as { existingId: string }).existingId).toBe(annotation.id);
    }
  });

  test("the same node reached by @id and by path is still the same node", async () => {
    // The conflict check resolves both locators before comparing — addressing
    // one node two ways must not sneak a second note onto it.
    unwrap(await add("@hero", "by id"));
    const clash = await add([0], "by path");
    expect(clash.ok).toBe(false);
    expect(ctx.folder.annotations.get("home")).toHaveLength(1);
  });

  test("refuses an anchor that addresses nothing", async () => {
    expect((await add([9])).ok).toBe(false);
    expect((await add("@nope")).ok).toBe(false);
    expect(await sidecar().exists()).toBe(false);
  });

  test("refuses an unknown screen", async () => {
    const result = await addAnnotation(ctx, {
      screenId: "ghost",
      target: { locator: [] },
      body: "x",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("ScreenNotFound");
  });
});

describe("update_annotation", () => {
  let id: string;

  beforeEach(async () => {
    id = unwrap(await add([0], "original", { collapsed: true })).annotation.id;
  });

  test("patches only the fields it was given", async () => {
    const { annotation } = unwrap(
      await updateAnnotation(ctx, {
        screenId: "home",
        annotationId: id,
        patch: { body: "edited" },
      }),
    );
    expect(annotation.body).toBe("edited");
    expect(annotation.collapsed).toBe(true);
    expect(annotation.position).toBe("auto");
    expect(annotation.target.locator).toEqual([0]);
  });

  test("moves a note to an explicit position and back to auto", async () => {
    unwrap(
      await updateAnnotation(ctx, {
        screenId: "home",
        annotationId: id,
        patch: { position: { x: 5, y: 6 } },
      }),
    );
    const back = unwrap(
      await updateAnnotation(ctx, {
        screenId: "home",
        annotationId: id,
        patch: { position: "auto" },
      }),
    );
    expect(back.annotation.position).toBe("auto");
  });

  test("null clears the collapse flag, false merely sets it", async () => {
    const off = unwrap(
      await updateAnnotation(ctx, {
        screenId: "home",
        annotationId: id,
        patch: { collapsed: false },
      }),
    );
    expect(off.annotation.collapsed).toBe(false);

    const cleared = unwrap(
      await updateAnnotation(ctx, {
        screenId: "home",
        annotationId: id,
        patch: { collapsed: null },
      }),
    );
    expect(cleared.annotation).not.toHaveProperty("collapsed");
    const onDisk = (await sidecar().json()) as Annotation[];
    expect(onDisk[0]).not.toHaveProperty("collapsed");
  });

  test("leaves its neighbours alone", async () => {
    const other = unwrap(await add([1], "sibling")).annotation.id;
    unwrap(
      await updateAnnotation(ctx, {
        screenId: "home",
        annotationId: id,
        patch: { body: "edited" },
      }),
    );
    const list = ctx.folder.annotations.get("home") ?? [];
    expect(list.map((a) => a.body)).toEqual(["edited", "sibling"]);
    expect(list.find((a) => a.id === other)?.body).toBe("sibling");
  });

  test("an unknown id on a screen that has notes is AnnotationNotFound", async () => {
    const result = await updateAnnotation(ctx, {
      screenId: "home",
      annotationId: "ann_nope",
      patch: { body: "x" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("AnnotationNotFound");
  });

  test("a screen with no sidecar says no such note, not no such screen", async () => {
    const result = await updateAnnotation(ctx, {
      screenId: "bare",
      annotationId: "ann_nope",
      patch: { body: "x" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("AnnotationNotFound");
  });

  test("a screen that doesn't exist says so", async () => {
    const result = await updateAnnotation(ctx, {
      screenId: "ghost",
      annotationId: "ann_nope",
      patch: { body: "x" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("ScreenNotFound");
  });
});

describe("remove_annotation", () => {
  test("removes one and leaves the rest", async () => {
    const first = unwrap(await add([0], "first")).annotation.id;
    unwrap(await add([1], "second"));
    const { removedId } = unwrap(
      await removeAnnotation(ctx, { screenId: "home", annotationId: first }),
    );
    expect(removedId).toBe(first);
    expect(ctx.folder.annotations.get("home")?.map((a) => a.body)).toEqual(["second"]);
  });

  test("removing the last one deletes the sidecar rather than leaving []", async () => {
    const id = unwrap(await add([0])).annotation.id;
    expect(await sidecar().exists()).toBe(true);
    unwrap(await removeAnnotation(ctx, { screenId: "home", annotationId: id }));
    expect(await sidecar().exists()).toBe(false);
    expect(ctx.folder.annotations.get("home")).toEqual([]);
  });

  test("frees the anchor, so the node can be annotated again", async () => {
    const id = unwrap(await add([0], "first")).annotation.id;
    unwrap(await removeAnnotation(ctx, { screenId: "home", annotationId: id }));
    expect((await add([0], "second")).ok).toBe(true);
  });

  test("distinguishes an unknown note from an unknown screen", async () => {
    unwrap(await add([0]));
    const unknownNote = await removeAnnotation(ctx, {
      screenId: "home",
      annotationId: "ann_nope",
    });
    expect(unknownNote.ok).toBe(false);
    if (!unknownNote.ok) expect(unknownNote.error.kind).toBe("AnnotationNotFound");

    const unknownScreen = await removeAnnotation(ctx, {
      screenId: "ghost",
      annotationId: "ann_nope",
    });
    expect(unknownScreen.ok).toBe(false);
    if (!unknownScreen.ok) expect(unknownScreen.error.kind).toBe("ScreenNotFound");
  });
});
