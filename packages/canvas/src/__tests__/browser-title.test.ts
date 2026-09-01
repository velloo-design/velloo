import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { formatBrowserTitle } from "../browser-title.ts";

test("canvas title keeps the accepted project · board - velloo format", () => {
  expect(formatBrowserTitle()).toBe("velloo");
  expect(formatBrowserTitle("pulse")).toBe("pulse - velloo");
  expect(formatBrowserTitle("pulse", "Checkout")).toBe("pulse · Checkout - velloo");

  // A board switch changes the board segment without changing the project.
  expect(formatBrowserTitle("pulse", "Confirmation")).toBe("pulse · Confirmation - velloo");
});

test("canvas HTML uses a lowercase loading fallback", async () => {
  const html = await readFile(new URL("../../index.html", import.meta.url), "utf8");
  expect(html).toContain("<title>velloo</title>");
  expect(html).not.toMatch(/<title>[^<]*Velloo/);
});
