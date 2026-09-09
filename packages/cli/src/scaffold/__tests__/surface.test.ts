import { describe, expect, test } from "bun:test";
import { BoardSchema, ScreenSchema, SnippetSchema } from "@velloo/schema";
import { buildDefaultTheme } from "../default-theme.ts";
import { buildElsewhereScaffold } from "../elsewhere-sample.ts";

describe("Elsewhere welcome sample", () => {
  for (const library of ["shadcn-upstream", "mui", "antd", "chakra", "none"] as const) {
    test(`${library} ships complete boards, valid screens and local images`, async () => {
      const sample = buildElsewhereScaffold(library, buildDefaultTheme());
      expect(sample.screens.length).toBe(7);
      expect(sample.screens[0]?.id).toBe("elsewhere-discover");
      expect(sample.boards.map((b) => b.id)).toEqual(["main", "elsewhere-details"]);
      expect(sample.boards[1]?.name).toBe("Agentic trip creation exploration");
      const screens = new Set(sample.screens.map((s) => s.id));
      for (const screen of sample.screens) ScreenSchema.parse(screen);
      for (const snippet of sample.snippets) SnippetSchema.parse(snippet);
      for (const board of sample.boards) {
        BoardSchema.parse(board);
        for (const frame of board.frames) expect(screens.has(frame.screen)).toBe(true);
      }
      expect(Object.keys(sample.assetFiles ?? {}).length).toBe(7);
      for (const path of Object.values(sample.assetFiles ?? {}))
        expect(await Bun.file(path).exists()).toBe(true);
      expect(sample.notes[0]?.entries.length).toBeGreaterThan(0);
    });
  }
});
