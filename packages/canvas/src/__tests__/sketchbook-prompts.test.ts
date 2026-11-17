import { expect, test } from "bun:test";
import { SketchbookFileSchema } from "@velloo/schema";
import { chosenWords } from "../components/Sketchbook/chosen.ts";
import { designFromImages } from "../components/Sketchbook/prompts.ts";

const DIR = "assets/sketchbook/sb1/poster";
const img = (kind: string, name: string) => ({
  kind,
  path: `${DIR}/${name}`,
  model: "m",
  prompt: "p",
  createdAt: "2026-11-13T00:00:00Z",
});

const withChosen = (names: string[]) =>
  SketchbookFileSchema.parse({
    version: 1,
    stage: "screens",
    brief: { origin: "new", product: "Trailhead", page: "the landing page" },
    directions: [
      {
        id: "poster",
        title: "Park poster",
        description: "Screen-printed",
        images: [
          img("moodboard", "board-1.png"),
          img("mock", "mock-1.png"),
          img("mock", "mock-2.png"),
        ],
      },
    ],
    chosen: names.map((n) => ({ direction: "poster", image: `${DIR}/${n}` })),
  });

const build = (names: string[]) => designFromImages(chosenWords(withChosen(names)), "");

test("the Build message names one chosen image once", () => {
  expect(build(["mock-1.png"])).toBe("Design screens from the mock I chose.");
});

test("the Build message counts several chosen images", () => {
  expect(build(["mock-1.png", "mock-2.png"])).toBe("Design screens from 2 mocks I chose.");
});

test("the Build message puts a chosen mood board first", () => {
  expect(build(["mock-1.png", "board-1.png"])).toBe(
    "Design screens from the mood board and the mock I chose.",
  );
  expect(build(["board-1.png"])).toBe("Design screens from the mood board I chose.");
});

test("the Build message carries the person's instructions after it", () => {
  const sketchbook = withChosen(["mock-1.png"]);
  expect(designFromImages(chosenWords(sketchbook), "  Dark mode too. ")).toBe(
    "Design screens from the mock I chose. Dark mode too.",
  );
});
