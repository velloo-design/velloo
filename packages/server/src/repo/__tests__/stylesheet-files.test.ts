import { describe, expect, test } from "bun:test";
import { SHEET_REF } from "../stylesheet-files.ts";

/**
 * Which import specifiers the stylesheet hook is offered. The hook answers only
 * for a stylesheet's `url()`s, but it is registered by specifier alone, and a
 * script's relative import must never reach it: see {@link SHEET_REF}.
 */
describe("SHEET_REF", () => {
  test("matches what a stylesheet's url() names", () => {
    for (const ref of [
      "./beside.woff2",
      "../img/hero.png",
      "sprite.svg#icon",
      "./font.woff?v=3",
      "some-package/fonts/inter.woff2",
      "/fonts/served.woff2",
      "/not-in-the-app",
      "https://cdn.example.com/a.png",
      "data:image/png;base64,AAAA",
    ]) {
      expect([ref, SHEET_REF.test(ref)]).toEqual([ref, true]);
    }
  });

  test("leaves a script's or a stylesheet's own imports to the bundler", () => {
    for (const ref of [
      "./icons/star.js",
      "./createLucideIcon",
      "../shared/src/utils",
      "./Button.tsx",
      "./index.mjs",
      "./legacy.cjs",
      "./vendor.min.js",
      "./chunk.js?v=3",
      "./data.json",
      "./tokens.css",
      "./card.module.css",
      "lucide-react",
      "@mantine/core",
      "react/jsx-runtime",
    ]) {
      expect([ref, SHEET_REF.test(ref)]).toEqual([ref, false]);
    }
  });
});
