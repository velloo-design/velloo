import { describe, expect, test } from "bun:test";
import { similarityNote } from "../compare-to-url.ts";
import { mountStandIns, standInDiagnostics } from "../screenshot-helpers.ts";

describe("similarityNote", () => {
  test("says nothing when the score speaks for itself", () => {
    expect(
      similarityNote({ similarity: 0.92, contentSimilarity: 0.92, heightDelta: 0 }),
    ).toBeNull();
    // A height gap that the overlap score does not excuse is just a real gap.
    expect(
      similarityNote({ similarity: 0.71, contentSimilarity: 0.73, heightDelta: 40 }),
    ).toBeNull();
  });

  test("names alignment when forgiving a pixel recovers most of the gap", () => {
    const note = similarityNote({
      similarity: 0.94,
      contentSimilarity: 0.94,
      heightDelta: 0,
      alignedSimilarity: 0.991,
    });
    expect(note).toContain("mostly alignment");
    expect(note).toContain("fix the topmost mismatch");
    expect(note).toContain("0.991");
    // A gap the shift doesn't explain is a real mismatch, and says nothing here.
    expect(
      similarityNote({
        similarity: 0.94,
        contentSimilarity: 0.94,
        heightDelta: 0,
        alignedSimilarity: 0.945,
      }),
    ).toBeNull();
  });

  test("explains a height-dominated score, and does not call it a mismatch", () => {
    const note = similarityNote({ similarity: 0.2, contentSimilarity: 0.86, heightDelta: -1035 });
    expect(note).toContain("1035px height difference");
    expect(note).toContain("trust contentSimilarity");
  });

  test("fires hardest at the bottom, where the number is most misread", () => {
    // The reported case: 0.05 with a 1457px gap returned a bare score and a
    // region covering the page with node: null, and nothing tied the two.
    const note = similarityNote({ similarity: 0.05, contentSimilarity: 0.09, heightDelta: -1457 });
    expect(note).toContain("differ structurally");
    expect(note).toContain("do not work through them yet");
    // The height delta was already in the payload; the note connects it.
    expect(note).toContain("1457px shorter");
    expect(note).toContain("whole sections missing");
    expect(note).toContain("get_capture");
  });

  test("a low score with matching heights skips the height clause", () => {
    const note = similarityNote({ similarity: 0.11, contentSimilarity: 0.11, heightDelta: 0 });
    expect(note).toContain("differ structurally");
    expect(note).not.toContain("px ");
  });

  test("height dominance wins over the low-score note when both could apply", () => {
    // Same score, but the overlap says the content is actually fine — that is a
    // different diagnosis and a different next move.
    const note = similarityNote({ similarity: 0.083, contentSimilarity: 0.9, heightDelta: -1457 });
    expect(note).toContain("not by content mismatch");
    expect(note).not.toContain("differ structurally");
  });

  test("taller and shorter are named correctly", () => {
    expect(similarityNote({ similarity: 0.1, contentSimilarity: 0.1, heightDelta: 900 })).toContain(
      "900px taller",
    );
  });
});

describe("a diff that does not localize", () => {
  const diffuse = { share: 0.99, coverage: 0.95 };

  test("fires at a high score, where the list looks trustworthy", () => {
    const note = similarityNote({
      similarity: 0.8942,
      contentSimilarity: 0.8942,
      heightDelta: 0,
      topRegion: diffuse,
    });
    expect(note).toContain("does not localize");
    expect(note).toContain("restating the score");
    expect(note).toContain("styleDiff");
  });

  test("names the shape of the cause rather than the region", () => {
    const note = similarityNote({
      similarity: 0.89,
      contentSimilarity: 0.89,
      heightDelta: 0,
      topRegion: diffuse,
    }) as string;
    // The actionable claim: spread-out difference is one value wrong globally.
    expect(note).toContain("one value wrong everywhere");
    expect(note).not.toContain("in order");
  });

  test("a localized diff is left alone — the region list is doing its job", () => {
    expect(
      similarityNote({
        similarity: 0.89,
        contentSimilarity: 0.89,
        heightDelta: 0,
        topRegion: { share: 0.62, coverage: 0.08 },
      }),
    ).toBeNull();
  });

  test("a big region holding little of the diff is not diffuse", () => {
    expect(
      similarityNote({
        similarity: 0.89,
        contentSimilarity: 0.89,
        heightDelta: 0,
        topRegion: { share: 0.4, coverage: 0.9 },
      }),
    ).toBeNull();
  });

  test("alignment still wins — it is the more specific reading", () => {
    const note = similarityNote({
      similarity: 0.9127,
      contentSimilarity: 0.9127,
      heightDelta: 0,
      alignedSimilarity: 0.9612,
      topRegion: diffuse,
    }) as string;
    expect(note).toContain("mostly alignment");
  });
});

describe("a diff that does not localize, with a height difference", () => {
  test("names the height as the same cause seen from the side", () => {
    const note = similarityNote({
      similarity: 0.8,
      contentSimilarity: 0.85,
      heightDelta: -40,
      topRegion: { share: 0.95, coverage: 0.9 },
    }) as string;
    expect(note).toContain("does not localize");
    expect(note).toContain("40px shorter");
  });

  test("defers to the server fallback instead of reading the score as one wrong value", () => {
    const note = similarityNote({
      similarity: 0.41,
      contentSimilarity: 0.9,
      heightDelta: 1180,
      alignedSimilarity: 0.6,
      serverFallback: true,
    });
    expect(note).toContain("server fallback");
    expect(note).toContain("render/server-fallback");
    expect(note).toContain("1180px");
    expect(note).not.toContain("one value is wrong");
  });

  // The antd eval: every library component was a static fallback, and the note
  // blamed "an 838px height difference, not content mismatch" — sending the
  // agent after spacing that was never the problem.
  test("names stand-in components as the likely cause before any layout reading", () => {
    const note = similarityNote({
      similarity: 0.366,
      contentSimilarity: 0.8,
      heightDelta: 838,
      standIns: ["Flex", "Tag", "Card"],
    }) as string;
    expect(note).toContain("Flex, Tag, Card");
    expect(note).toContain("render/stand-ins");
    expect(note).toContain("838px");
    expect(note).not.toContain("not by content mismatch");
  });

  // The gantry eval: alignedSimilarity 0.960 against 0.893 is a measured cause,
  // and the stand-in line must not bury it.
  test("a measured alignment gap still leads, with the stand-ins kept beside it", () => {
    const note = similarityNote({
      similarity: 0.893,
      contentSimilarity: 0.9,
      heightDelta: 0,
      alignedSimilarity: 0.96,
      standIns: ["Panel"],
    }) as string;
    expect(note.startsWith("similarity 0.893 is mostly alignment")).toBe(true);
    expect(note).toContain("Panel");
    expect(note).toContain("render/stand-ins");
  });

  test("the server fallback still wins: nothing mounted, so there is nothing to single out", () => {
    const note = similarityNote({
      similarity: 0.4,
      contentSimilarity: 0.4,
      heightDelta: 0,
      serverFallback: true,
      standIns: ["Tag"],
    });
    expect(note).toContain("render/server-fallback");
  });
});

describe("standInDiagnostics", () => {
  test("counts substitutes, not declared placeholders or named adaptations", () => {
    const canvas = {
      mounted: true,
      diagnostics: [
        { id: "Button", status: "exact" },
        { id: "Dialog", status: "adapted" },
        { id: "Chart", status: "fallback", code: "extension" },
        { id: "Tag", status: "fallback", code: "static-fallback" },
        { id: "repo:x", name: "Header", status: "proxy", code: "render-threw" },
      ],
    };
    expect(mountStandIns(canvas).map((entry) => entry.id)).toEqual(["Tag", "repo:x"]);
    const [diagnostic] = standInDiagnostics(canvas);
    expect(diagnostic?.code).toBe("render/stand-ins");
    expect(diagnostic?.message).toContain("Tag (fallback, static-fallback)");
    expect(diagnostic?.message).toContain("Header (proxy, render-threw)");
    expect(diagnostic?.message).not.toContain("Chart");
    expect(
      standInDiagnostics({ mounted: true, diagnostics: [{ id: "Button", status: "exact" }] }),
    ).toEqual([]);
    expect(standInDiagnostics(undefined)).toEqual([]);
  });
});

/**
 * The Mantine eval: 0.7818 → aligned 0.8127 with a ~290px height gap, while 38
 * nodes were Velloo's `Text` rather than the app's. "Mostly alignment … a
 * padding" sent the agent tuning spacing on the wrong components.
 */
describe("the alignment reading is earned, not assumed", () => {
  const codex = {
    similarity: 0.7818,
    contentSimilarity: 0.8,
    heightDelta: 286,
    alignedSimilarity: 0.8127,
  };
  const shadowed = [
    { ref: "Text", appIds: ["Mantine.Text"], count: 38, path: [0] },
    { ref: "Badge", appIds: ["Mantine.Badge"], count: 2, path: [3] },
  ];

  test("a small share of the gap won back is not 'mostly alignment'", () => {
    // 0.031 of a 0.218 gap is 14%, and the height gap alone rules it out.
    const note = similarityNote({ ...codex, heightDelta: 0 });
    expect(note ?? "").not.toContain("mostly alignment");
    expect(note ?? "").not.toContain("one value is wrong");
  });

  test("a large height gap is not something one padding opens", () => {
    // Recovers 70% of the gap, but 300px is content, not a cascading offset.
    const note = similarityNote({
      similarity: 0.9,
      contentSimilarity: 0.97,
      heightDelta: -300,
      alignedSimilarity: 0.97,
    }) as string;
    expect(note).not.toContain("mostly alignment");
    expect(note).toContain("300px height difference");
  });

  test("Velloo components under the app's names lead when alignment does not explain the score", () => {
    const note = similarityNote({ ...codex, shadowed, standIns: ["Panel"] }) as string;
    expect(note.startsWith("similarity 0.7818 is held down by 40 nodes")).toBe(true);
    expect(note).toContain("Text ×38 → <Mantine.Text>");
    expect(note).toContain("repo/shadowed-by-velloo");
    expect(note).toContain("286px");
    expect(note).toContain("Panel");
    expect(note).not.toContain("mostly alignment");
    expect(note).not.toContain("a padding");
  });

  test("a measured alignment still leads, and names the wrong components beside it", () => {
    const note = similarityNote({
      similarity: 0.893,
      contentSimilarity: 0.9,
      heightDelta: 0,
      alignedSimilarity: 0.96,
      shadowed,
    }) as string;
    expect(note.startsWith("similarity 0.893 is mostly alignment")).toBe(true);
    expect(note).toContain("<Mantine.Text>");
    expect(note).toContain("repo/shadowed-by-velloo");
  });
});
