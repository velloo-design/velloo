import { describe, expect, test } from "bun:test";
import type { MutationError, ThemeError } from "@velloo/protocol";
import { type ApiError, describeApiError } from "../api/errors.ts";

/**
 * The canvas renders the server's typed failures. It used to read a `message`
 * field that 23 of the 28 `MutationError` variants do not have, so most
 * failures reached the user as "mutate/add_node: 404". These assert the
 * variants that carry no `message` still produce a real sentence, and that the
 * detail the server took the trouble to compute actually reaches the toast.
 */

const MUTATION_SAMPLES: MutationError[] = [
  { kind: "ScreenNotFound", screenId: "landing" },
  { kind: "BoardNotFound", boardId: "main" },
  { kind: "FrameNotFound", boardId: "main", frameId: "f1" },
  { kind: "BoardGroupNotFound", groupId: "g1" },
  { kind: "UnknownComponent", ref: "Buton", suggestions: ["Button", "Badge"] },
  { kind: "InvalidPath", reason: "path [0,9] does not resolve" },
  { kind: "InvalidMove", reason: "cannot move a node into itself" },
  { kind: "LastScreen", screenId: "landing" },
  { kind: "ScreenIdConflict", screenId: "landing" },
  { kind: "ScreenIdExhausted", base: "landing" },
  { kind: "BoardIdConflict", boardId: "main" },
  { kind: "BoardIdExhausted", base: "main" },
  { kind: "FrameIdConflict", boardId: "main", frameId: "f1" },
  { kind: "BadRequest", message: "Request body failed validation." },
  { kind: "SnippetNotFound", snippetId: "hero" },
  { kind: "SnippetParamMismatch", snippetId: "hero", reason: "missing required param `title`" },
  { kind: "SnippetCycle", snippetId: "hero", viaPath: ["hero", "cta"] },
  { kind: "SnippetInUse", snippetId: "hero", screenIds: ["landing", "pricing"] },
  { kind: "SnippetIdConflict", snippetId: "hero" },
  { kind: "IdNotFound", screenId: "landing", id: "cta" },
  { kind: "IdConflict", screenId: "landing", id: "cta", paths: [[0], [1]] },
  { kind: "AnnotationConflict", screenId: "landing", locator: [0], existingId: "a1" },
  { kind: "AnnotationNotFound", screenId: "landing", annotationId: "a1" },
  { kind: "CanvasNoteNotFound", noteId: "n1" },
  { kind: "ExtensionIdConflict", extensionId: "chart", message: "Extension exists." },
  { kind: "ExtensionNotFound", extensionId: "chart", message: "No such extension." },
  { kind: "ExtensionInUse", extensionId: "chart", message: "Still referenced.", references: [] },
  { kind: "InvalidExtensionProp", extensionId: "chart", message: "Bad prop.", prop: "series" },
];

const THEME_SAMPLES: ThemeError[] = [
  { kind: "InvalidColor", reason: "not a color" },
  { kind: "InvalidThemePath", reason: "unknown token path" },
  { kind: "UnknownPreset", presetName: "midnight" },
  { kind: "BadRequest", message: "Request body failed validation." },
  {
    kind: "BulkTokensInvalid",
    applied: ["colors.primary"],
    failed: [{ path: "colors.accent", reason: "not a color" }],
  },
];

describe("describeApiError", () => {
  test("every MutationError variant renders a non-empty sentence", () => {
    for (const error of MUTATION_SAMPLES) {
      const message = describeApiError(error);
      expect(message.length, `${error.kind} rendered empty`).toBeGreaterThan(0);
      expect(message, `${error.kind} fell through to the generic message`).not.toBe(
        "The change could not be applied.",
      );
    }
  });

  test("every ThemeError variant renders a non-empty sentence", () => {
    for (const error of THEME_SAMPLES) {
      expect(describeApiError(error).length).toBeGreaterThan(0);
    }
  });

  test("the sample list covers the whole MutationError union", () => {
    // Guards against a variant being added to the protocol and silently going
    // untested here — `describeApiError`'s own `never` guard covers the render.
    const kinds = new Set(MUTATION_SAMPLES.map((e) => e.kind));
    expect(kinds.size).toBe(MUTATION_SAMPLES.length);
    expect(kinds.size).toBe(28);
  });

  test("UnknownComponent surfaces the server's suggestions", () => {
    const message = describeApiError({
      kind: "UnknownComponent",
      ref: "Buton",
      suggestions: ["Button", "Badge"],
    });
    expect(message).toContain("Buton");
    expect(message).toContain("Button");
    expect(message).toContain("Badge");
  });

  test("a hint is appended when the server sent one", () => {
    const withHint: ApiError = {
      kind: "ScreenIdConflict",
      screenId: "landing",
      hint: "Build into it instead.",
    };
    expect(describeApiError(withHint)).toContain("Build into it instead.");
  });

  test("BulkTokensInvalid says nothing was saved", () => {
    const message = describeApiError({
      kind: "BulkTokensInvalid",
      applied: [],
      failed: [{ path: "colors.accent", reason: "not a color" }],
    });
    expect(message).toContain("colors.accent");
    expect(message).toContain("Nothing was saved.");
  });
});
