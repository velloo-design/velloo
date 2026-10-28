import { describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  mergeRules,
  parseRules,
  readDesignRules,
  restoreDesignRules,
  writeDesignRules,
} from "../design-rules.ts";
import { designSystemDoc } from "../design-system.ts";
import { designConfig, testContext } from "../testing/design-folder.ts";

/**
 * The rules are the one part of a design language a person writes in words,
 * and a reviewer quotes them back verbatim — so what is read has to be what
 * was written, in every shape people write it.
 */

describe("parseRules", () => {
  test("reads a label off each bullet, however it is punctuated", () => {
    expect(
      parseRules(
        [
          "- Do use one primary action per view",
          "- Don't mix rounded and sharp corners",
          "- **Do:** keep headings in sentence case",
          "- Don’t: use colour alone for status",
          "- Do not stack two accents",
        ].join("\n"),
      ),
    ).toEqual([
      { kind: "do", text: "use one primary action per view" },
      { kind: "dont", text: "mix rounded and sharp corners" },
      { kind: "do", text: "keep headings in sentence case" },
      { kind: "dont", text: "use colour alone for status" },
      { kind: "dont", text: "stack two accents" },
    ]);
  });

  test("an unlabelled bullet takes the subheading it sits under", () => {
    expect(
      parseRules(
        ["### Do", "- One accent", "", "### Don't", "- Shadows on flat surfaces"].join("\n"),
      ),
    ).toEqual([
      { kind: "do", text: "One accent" },
      { kind: "dont", text: "Shadows on flat surfaces" },
    ]);
  });

  test("a word that only starts with Do is not a label", () => {
    expect(parseRules("- Document every exception")).toEqual([
      { kind: "do", text: "Document every exception" },
    ]);
  });

  test("a wrapped bullet is one rule", () => {
    expect(parseRules("- Do: keep the accent for\n  the thing you can act on")).toEqual([
      { kind: "do", text: "keep the accent for the thing you can act on" },
    ]);
  });
});

describe("mergeRules", () => {
  test("a new file states the intent first and the rules last", () => {
    expect(
      mergeRules(null, "Acme", {
        intent: "Calm and precise.",
        rules: [
          { kind: "do", text: "One primary action per view" },
          { kind: "dont", text: "Shadows on flat surfaces" },
        ],
      }),
    ).toBe(
      [
        "# Acme design guidance",
        "",
        "## Overview",
        "",
        "Calm and precise.",
        "",
        "## Do's and Don'ts",
        "",
        "- Do: One primary action per view",
        "- Don't: Shadows on flat surfaces",
        "",
      ].join("\n"),
    );
  });

  test("leaves what it does not own exactly as written", () => {
    const existing = [
      "---",
      "name: Acme",
      "---",
      "",
      "## Brand & Style",
      "",
      "Old intent.",
      "",
      "## Colors",
      "",
      "Indigo on warm white.",
      "",
      "## Do's and Don'ts",
      "",
      "- Don't use two accents.",
      "",
    ].join("\n");
    const merged = mergeRules(existing, "Acme", {
      intent: "New intent.",
      rules: [{ kind: "do", text: "One accent" }],
    });
    expect(merged).toContain("---\nname: Acme\n---");
    // The alias heading is edited in place rather than joined by a second Overview.
    expect(merged).toContain("## Brand & Style\n\nNew intent.");
    expect(merged).not.toContain("## Overview");
    expect(merged).toContain("## Colors\n\nIndigo on warm white.");
    expect(merged).toContain("## Do's and Don'ts\n\n- Do: One accent\n");
    expect(merged).not.toContain("two accents");
  });
});

describe("design rules on disk", () => {
  test("a folder that follows nothing has no rules and no source", async () => {
    const t = await testContext({ label: "rules-none", nested: true });
    try {
      expect(await readDesignRules(t.ctx.folder)).toEqual({ source: null, intent: "", rules: [] });
    } finally {
      await t.cleanup();
    }
  });

  test("writing creates guidance.md, and the folder then follows it", async () => {
    const t = await testContext({ label: "rules-write", nested: true });
    try {
      const rules = [{ kind: "dont" as const, text: "Shadows on flat surfaces" }];
      const saved = await writeDesignRules(t.ctx, { intent: "Calm.", rules });
      expect(saved).toEqual({
        ok: true,
        value: { source: { path: "guidance.md", writable: true }, intent: "Calm.", rules },
      });
      // Rules alone are enough for the agent and the reviewer to be pointed at the file.
      expect(designSystemDoc(t.ctx.folder)?.path).toBe("guidance.md");
      expect(t.events).toContainEqual({ type: "theme-changed" });
      // Named in the activity stream, so the canvas can tell the person an agent proposed rules.
      expect(t.events).toContainEqual(
        expect.objectContaining({ type: "activity", verb: "set_design_language" }),
      );
      expect(await readFile(join(t.root, "guidance.md"), "utf8")).toContain(
        "- Don't: Shadows on flat surfaces",
      );
    } finally {
      await t.cleanup();
    }
  });

  test("the repo's DESIGN.md is read, and never written", async () => {
    const t = await testContext({
      label: "rules-readonly",
      nested: true,
      config: designConfig({ hostApp: { root: ".." } }),
    });
    try {
      const designMd = join(t.root, "..", "DESIGN.md");
      const text = [
        "## Colors",
        "",
        "Indigo.",
        "",
        "## Typography",
        "",
        "Geist.",
        "",
        "## Do's and Don'ts",
        "",
        "- Don't use two accents.",
        "",
      ].join("\n");
      await writeFile(designMd, text, "utf8");
      expect(await readDesignRules(t.ctx.folder)).toEqual({
        source: { path: "../DESIGN.md", writable: false },
        intent: "",
        rules: [{ kind: "dont", text: "use two accents." }],
      });
      const refused = await writeDesignRules(t.ctx, { intent: "x", rules: [] });
      expect(refused.ok).toBe(false);
      expect(await readFile(designMd, "utf8")).toBe(text);
      await expect(readFile(join(t.root, "guidance.md"), "utf8")).rejects.toThrow();
    } finally {
      await t.cleanup();
    }
  });

  test("restoring to 'no rules yet' removes the file it created", async () => {
    const t = await testContext({ label: "rules-restore-new", nested: true });
    try {
      await writeDesignRules(t.ctx, { intent: "Calm.", rules: [] });
      const restored = await restoreDesignRules(t.ctx, null);
      expect(restored).toEqual({ ok: true, value: { source: null, intent: "", rules: [] } });
      await expect(readFile(join(t.root, "guidance.md"), "utf8")).rejects.toThrow();
    } finally {
      await t.cleanup();
    }
  });

  test("restoring never deletes notes that were in the file before", async () => {
    const t = await testContext({ label: "rules-restore-notes", nested: true });
    try {
      const notes = "Meeting notes from the kickoff.\n";
      await writeFile(join(t.root, "guidance.md"), notes, "utf8");
      await writeDesignRules(t.ctx, { intent: "Calm.", rules: [] });
      await restoreDesignRules(t.ctx, null);
      const after = await readFile(join(t.root, "guidance.md"), "utf8");
      expect(after).toContain("Meeting notes from the kickoff.");
      expect(after).not.toContain("Calm.");
    } finally {
      await t.cleanup();
    }
  });

  test("restoring to earlier rules writes them back", async () => {
    const t = await testContext({ label: "rules-restore-old", nested: true });
    try {
      const before = { intent: "Calm.", rules: [{ kind: "do" as const, text: "One accent" }] };
      await writeDesignRules(t.ctx, before);
      await writeDesignRules(t.ctx, { intent: "Loud.", rules: [] });
      const restored = await restoreDesignRules(t.ctx, before);
      expect(restored).toMatchObject({ ok: true, value: before });
    } finally {
      await t.cleanup();
    }
  });
});
