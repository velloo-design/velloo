import { expect, test } from "bun:test";
import { designFromDirections } from "../components/Sketchbook/prompts.ts";

test("the Build message names the one kept direction", () => {
  expect(designFromDirections(["Park poster"], 1, "")).toBe(
    'Design a screen from the direction "Park poster".',
  );
});

test("the Build message counts the takes on each direction", () => {
  expect(designFromDirections(["Park poster", "Swiss ledger"], 2, "")).toBe(
    'Design 2 screens from each of "Park poster" and "Swiss ledger", each a different take.',
  );
  expect(designFromDirections(["A", "B", "C"], 1, "")).toBe(
    'Design a screen from each of "A", "B" and "C".',
  );
});

test("the Build message carries the person's instructions after it", () => {
  expect(designFromDirections(["Park poster"], 1, "  Dark mode too. ")).toBe(
    'Design a screen from the direction "Park poster". Dark mode too.',
  );
});
