import { afterEach, beforeEach, expect, test } from "bun:test";
import { designBoard, type TestContext, testContext } from "../../testing/design-folder.ts";
import { imageryStyle, withImageryStyle } from "../imagery.ts";

let t: TestContext;

beforeEach(async () => {
  t = await testContext({
    screens: { home: true },
    boards: {
      park: designBoard("park", ["home"], { theme: "park" }),
      plain: designBoard("plain", ["home"]),
    },
    files: {
      "looks/park.json": {
        imagery: "Grainy risograph prints in two inks.",
        images: [
          { path: "assets/sketchbook/a/park/imagery-1.png", kind: "imagery" },
          { path: "assets/sketchbook/a/park/imagery-2.png", kind: "imagery" },
          { path: "assets/sketchbook/a/park/board-1.png", kind: "moodboard" },
        ],
      },
    },
  });
});

afterEach(() => t.cleanup());

test("a board's Look gives its latest imagery image and its note; a Look without either gives none", () => {
  expect(imageryStyle(t.ctx, "park")).toEqual({
    look: "park",
    image: "assets/sketchbook/a/park/imagery-2.png",
    note: "Grainy risograph prints in two inks.",
  });
  expect(imageryStyle(t.ctx, "plain")).toBeNull();
  expect(imageryStyle(t.ctx, undefined)).toBeNull();
});

test("a photo follows the imagery style; an icon doesn't", () => {
  const style = imageryStyle(t.ctx, "park");
  const photo = withImageryStyle({ intent: "photo", prompt: "A trail at dawn" }, style);
  expect(photo.req.prompt).toBe(
    "A trail at dawn Imagery style: Grainy risograph prints in two inks.",
  );
  expect(photo.req.reference).toEqual(["assets/sketchbook/a/park/imagery-2.png"]);
  expect(photo.said).toContain('Look "park"');
  expect(photo.said).toContain("style reference");

  // Three references are the cloud's limit: the note still goes.
  const full = withImageryStyle(
    { intent: "illustration", prompt: "p", reference: ["a.png", "b.png", "c.png"] },
    style,
  );
  expect(full.req.reference).toEqual(["a.png", "b.png", "c.png"]);
  expect(full.said).not.toContain("style reference");

  const icon = withImageryStyle({ intent: "icon", prompt: "A tent" }, style);
  expect(icon.req).toEqual({ intent: "icon", prompt: "A tent" });
  expect(icon.said).toBeUndefined();
});
