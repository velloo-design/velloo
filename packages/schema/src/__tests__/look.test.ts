import { describe, expect, test } from "bun:test";
import { LookSchema } from "../index.ts";

describe("LookSchema", () => {
  test("an empty file is a Look with nothing beyond its tokens", () => {
    expect(LookSchema.parse({})).toEqual({
      version: 1,
      description: "",
      images: [],
      references: [],
      rules: { dos: [], donts: [] },
      imagery: "",
      origin: null,
    });
  });

  test("an image keeps a kind it doesn't know yet, and defaults one it isn't given", () => {
    const look = LookSchema.parse({
      images: [{ path: "assets/a.png", kind: "type-poster" }, { path: "assets/b.png" }],
    });
    expect(look.images.map((i) => i.kind)).toEqual(["type-poster", "image"]);
  });

  test("rules default each list on its own", () => {
    expect(LookSchema.parse({ rules: { dos: ["Big type"] } }).rules).toEqual({
      dos: ["Big type"],
      donts: [],
    });
  });
});
