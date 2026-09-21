import { describe, expect, test } from "bun:test";
import { similarityNote } from "../compare-to-url.ts";

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
    // GPT-5.6 Terra spent eight passes at ~0.89 against one page-sized region
    // naming the root. The old guard only fired below 0.3, so nothing said so.
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
