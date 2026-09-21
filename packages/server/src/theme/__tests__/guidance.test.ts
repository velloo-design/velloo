import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { unwrap } from "@velloo/result";
import { GUIDANCE_FILENAME, loadDesignFolder } from "../../design-folder.ts";
import { testContext } from "../../testing/design-folder.ts";
import { guidanceRules, guidanceSections, setGuidance } from "../guidance.ts";
import { importThemeDesignMd } from "../index.ts";

const DESIGN_MD = `---
name: Quiet
colors:
  background: "#ffffff"
  on-background: "#111111"
  primary: "#4f46e5"
---

## Brand & Style

Quiet, precise, unhurried.

## Do's and Don'ts

- Don't use more than one accent per screen.
`;

describe("guidanceSections", () => {
  test("splits on ## headings and keeps the text under each", () => {
    expect(guidanceSections("## A\n\nfirst\n\n## B\n\nsecond\n")).toEqual({
      A: "first",
      B: "second",
    });
  });

  test("keeps text before the first heading instead of dropping it", () => {
    expect(guidanceSections("# Title\n\nintro\n\n## A\n\nbody")).toEqual({
      "": "# Title\n\nintro",
      A: "body",
    });
  });

  test("keeps ### subsections inside their parent section", () => {
    const out = guidanceSections("## Components\n\n### Buttons\n\nrounded\n");
    expect(out.Components).toContain("### Buttons");
  });

  test("a duplicate heading keeps the first, so nothing before it is lost", () => {
    expect(guidanceSections("## A\n\none\n\n## A\n\ntwo")).toEqual({ A: "one" });
  });

  test("an empty document has no sections", () => {
    expect(guidanceSections("")).toEqual({});
  });
});

describe("setGuidance", () => {
  test("writes guidance.md and updates the loaded folder", async () => {
    const t = await testContext({ label: "guidance" });
    try {
      const r = unwrap(await setGuidance(t.ctx.folder, "## Overview\n\nCalm."));
      expect(r.sections).toEqual(["Overview"]);
      expect(t.ctx.folder.guidance).toContain("Calm.");
      expect(await readFile(join(t.root, GUIDANCE_FILENAME), "utf8")).toContain("Calm.");
    } finally {
      await t.cleanup();
    }
  });

  test("survives a folder reload", async () => {
    const t = await testContext({ label: "guidance-reload" });
    try {
      await setGuidance(t.ctx.folder, "## Overview\n\nCalm.");
      const reloaded = await loadDesignFolder(t.root);
      expect(reloaded.guidance).toContain("Calm.");
    } finally {
      await t.cleanup();
    }
  });

  test("a folder without the file loads with empty guidance, not an error", async () => {
    const t = await testContext({ label: "guidance-absent" });
    try {
      expect(t.ctx.folder.guidance).toBe("");
    } finally {
      await t.cleanup();
    }
  });

  test("clearing writes an empty file rather than leaving stale prose", async () => {
    const t = await testContext({ label: "guidance-clear" });
    try {
      await setGuidance(t.ctx.folder, "## Overview\n\nCalm.");
      const r = unwrap(await setGuidance(t.ctx.folder, "  "));
      expect(r.markdown).toBe("");
      expect(r.sections).toEqual([]);
      expect((await loadDesignFolder(t.root)).guidance).toBe("");
    } finally {
      await t.cleanup();
    }
  });
});

describe("an imported DESIGN.md stores its prose", () => {
  test("applying writes the body to guidance.md", async () => {
    const t = await testContext({ label: "guidance-import" });
    try {
      const r = unwrap(await importThemeDesignMd(t.ctx, DESIGN_MD, { apply: true }));
      expect(r.prose.stored).toBe(true);
      expect(t.ctx.folder.guidance).toContain("Quiet, precise, unhurried.");
      expect(guidanceSections(t.ctx.folder.guidance)["Do's and Don'ts"]).toContain(
        "one accent per screen",
      );
    } finally {
      await t.cleanup();
    }
  });

  test("a dry run stores nothing", async () => {
    const t = await testContext({ label: "guidance-dry" });
    try {
      const r = unwrap(await importThemeDesignMd(t.ctx, DESIGN_MD));
      expect(r.prose.stored).toBe(false);
      expect(t.ctx.folder.guidance).toBe("");
    } finally {
      await t.cleanup();
    }
  });

  test("storeProse: false keeps the tokens and leaves existing guidance alone", async () => {
    const t = await testContext({ label: "guidance-opt-out" });
    try {
      await setGuidance(t.ctx.folder, "## Overview\n\nMine.");
      const r = unwrap(
        await importThemeDesignMd(t.ctx, DESIGN_MD, { apply: true, storeProse: false }),
      );
      expect(r.prose.stored).toBe(false);
      expect(r.theme.colors.background).toBe("#ffffff");
      expect(t.ctx.folder.guidance).toContain("Mine.");
    } finally {
      await t.cleanup();
    }
  });

  test("a file with no body stores nothing even when applying", async () => {
    const t = await testContext({ label: "guidance-bodyless" });
    try {
      const r = unwrap(
        await importThemeDesignMd(t.ctx, `---\nname: T\ncolors:\n  primary: "#111111"\n---\n`, {
          apply: true,
        }),
      );
      expect(r.prose.stored).toBe(false);
      expect(t.ctx.folder.guidance).toBe("");
    } finally {
      await t.cleanup();
    }
  });
});

describe("guidanceRules", () => {
  const rules = (body: string) => guidanceRules(body);

  test("splits the Do's and Don'ts list into individually quotable rules", () => {
    const out = rules(
      "## Do's and Don'ts\n\n- Do keep contrast high.\n- Don't use more than one accent per screen.\n",
    );
    expect(out).toEqual([
      { index: 1, kind: "do", text: "Do keep contrast high." },
      { index: 2, kind: "dont", text: "Don't use more than one accent per screen." },
    ]);
  });

  test("keeps the rule exactly as written, markdown and all, so it can be quoted", () => {
    const out = rules("## Do's and Don'ts\n\n- **Don't** introduce `glassmorphism`.\n");
    expect(out[0]?.text).toBe("**Don't** introduce `glassmorphism`.");
    // Emphasis must not defeat the classification.
    expect(out[0]?.kind).toBe("dont");
  });

  test("`Don't` is not read as `Do`", () => {
    expect(rules("## Do's and Don'ts\n\n- Do not add shadows.\n")[0]?.kind).toBe("dont");
    expect(rules("## Do's and Don'ts\n\n- Never add shadows.\n")[0]?.kind).toBe("dont");
    expect(rules("## Do's and Don'ts\n\n- Avoid shadows.\n")[0]?.kind).toBe("dont");
  });

  test("a rule phrased as neither is `unspecified` rather than guessed", () => {
    expect(rules("## Do's and Don'ts\n\n- Reserve the accent for CTAs.\n")[0]?.kind).toBe(
      "unspecified",
    );
  });

  test("finds the section however its apostrophe was typed", () => {
    // Hand-written far more often than generated: curly, straight, or absent.
    for (const heading of [
      "Do's and Don'ts",
      "Do’s and Don’ts",
      "Dos and Donts",
      "DO'S AND DON'TS",
    ]) {
      expect(rules(`## ${heading}\n\n- Do keep it simple.\n`)).toHaveLength(1);
    }
  });

  test("reads numbered and asterisk lists too", () => {
    expect(rules("## Do's and Don'ts\n\n1. Do one thing.\n2. Do another.\n")).toHaveLength(2);
    expect(rules("## Do's and Don'ts\n\n* Do one thing.\n")).toHaveLength(1);
  });

  test("keeps a rule that wraps onto a second line whole", () => {
    const out = rules(
      "## Do's and Don'ts\n\n- Do keep CTAs pill-shaped,\n  including on dark bands.\n- Don't square them.\n",
    );
    expect(out).toHaveLength(2);
    expect(out[0]?.text).toContain("including on dark bands");
  });

  test("a section written as prose yields one rule per paragraph, not nothing", () => {
    const out = rules(
      "## Do's and Don'ts\n\nAlways lead with the product shot.\n\nNever stack two CTAs.\n",
    );
    expect(out.map((r) => r.kind)).toEqual(["do", "dont"]);
  });

  test("no section ⇒ no rules, which is not the same as no violations", () => {
    expect(rules("## Overview\n\nCalm.\n")).toEqual([]);
    expect(rules("")).toEqual([]);
  });

  test("an empty Do's and Don'ts section yields nothing rather than a blank rule", () => {
    expect(rules("## Do's and Don'ts\n\n## Overview\n\nCalm.\n")).toEqual([]);
  });

  test("ignores other sections' lists", () => {
    const out = rules(
      "## Colors\n\n- Primary is amber.\n- Secondary is blue.\n\n## Do's and Don'ts\n\n- Do keep contrast high.\n",
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.text).toBe("Do keep contrast high.");
  });
});
